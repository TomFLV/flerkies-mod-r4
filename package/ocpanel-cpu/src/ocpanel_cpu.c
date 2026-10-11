// SPDX-License-Identifier: GPL-2.0
/*
 * ocpanel_cpu - clean CPU clock + core-voltage control for MT7988 (BPI-R4).
 *
 * Uses the kernel's clk and regulator frameworks (NOT raw register/I2C pokes):
 *   - clk_set_rate() on the arm_b PLL  -> any CPU frequency, glitchless.
 *   - regulator_set_voltage() on vproc -> any core voltage, PMIC-driver-handled.
 *
 * Exposes simple, human-unit sysfs on the platform device:
 *   freq_mhz    (RW)  current / target CPU frequency in MHz
 *   voltage_mv  (RW)  current / target vproc in millivolts
 *   info        (RO)  one-line summary
 *
 * Hard safety limits are compiled in and cannot be exceeded from userspace.
 */
#include <linux/module.h>
#include <linux/platform_device.h>
#include <linux/of.h>
#include <linux/clk.h>
#include <linux/regulator/consumer.h>
#include <linux/sysfs.h>
#include <linux/kernel.h>

#define OC_FREQ_MIN_MHZ   600u
#define OC_FREQ_MAX_MHZ   2500u     /* matches MT7988 PLL FMAX */
#define OC_UV_MIN         600000    /* 0.60 V */
#define OC_UV_MAX         1100000   /* 1.10 V hard cap (per owner) */

struct oc_dev {
	struct device   *dev;
	struct clk      *armpll;
	struct regulator *vproc;
};
static struct oc_dev *g_oc;

static ssize_t freq_mhz_show(struct device *dev, struct device_attribute *attr, char *buf)
{
	unsigned long hz = g_oc ? clk_get_rate(g_oc->armpll) : 0;
	return sysfs_emit(buf, "%lu\n", hz / 1000000UL);
}

static ssize_t freq_mhz_store(struct device *dev, struct device_attribute *attr,
			      const char *buf, size_t count)
{
	unsigned int mhz;
	int ret;

	if (!g_oc)
		return -ENODEV;
	ret = kstrtouint(buf, 10, &mhz);
	if (ret)
		return ret;
	if (mhz < OC_FREQ_MIN_MHZ || mhz > OC_FREQ_MAX_MHZ) {
		dev_warn(dev, "freq %u MHz out of [%u,%u] - refused\n",
			 mhz, OC_FREQ_MIN_MHZ, OC_FREQ_MAX_MHZ);
		return -ERANGE;
	}
	ret = clk_set_rate(g_oc->armpll, (unsigned long)mhz * 1000000UL);
	if (ret) {
		dev_err(dev, "clk_set_rate(%u MHz) failed: %d\n", mhz, ret);
		return ret;
	}
	return count;
}
static DEVICE_ATTR_RW(freq_mhz);

static ssize_t voltage_mv_show(struct device *dev, struct device_attribute *attr, char *buf)
{
	int uv = g_oc ? regulator_get_voltage(g_oc->vproc) : -ENODEV;
	if (uv < 0)
		return uv;
	return sysfs_emit(buf, "%d\n", uv / 1000);
}

static ssize_t voltage_mv_store(struct device *dev, struct device_attribute *attr,
				const char *buf, size_t count)
{
	unsigned int mv;
	int ret, uv;

	if (!g_oc)
		return -ENODEV;
	ret = kstrtouint(buf, 10, &mv);
	if (ret)
		return ret;
	uv = mv * 1000;
	if (uv < OC_UV_MIN || uv > OC_UV_MAX) {
		dev_warn(dev, "voltage %u mV out of [%d,%d] - refused\n",
			 mv, OC_UV_MIN / 1000, OC_UV_MAX / 1000);
		return -ERANGE;
	}
	ret = regulator_set_voltage(g_oc->vproc, uv, uv);
	if (ret) {
		dev_err(dev, "regulator_set_voltage(%u mV) failed: %d\n", mv, ret);
		return ret;
	}
	return count;
}
static DEVICE_ATTR_RW(voltage_mv);

static ssize_t info_show(struct device *dev, struct device_attribute *attr, char *buf)
{
	unsigned long hz = clk_get_rate(g_oc->armpll);
	int uv = regulator_get_voltage(g_oc->vproc);
	return sysfs_emit(buf, "freq=%lu MHz voltage=%d mV limits=[%u-%u MHz, %d-%d mV]\n",
			  hz / 1000000UL, (uv > 0 ? uv / 1000 : -1),
			  OC_FREQ_MIN_MHZ, OC_FREQ_MAX_MHZ, OC_UV_MIN / 1000, OC_UV_MAX / 1000);
}
static DEVICE_ATTR_RO(info);

static struct attribute *oc_attrs[] = {
	&dev_attr_freq_mhz.attr,
	&dev_attr_voltage_mv.attr,
	&dev_attr_info.attr,
	NULL,
};
ATTRIBUTE_GROUPS(oc);

static int oc_probe(struct platform_device *pdev)
{
	struct oc_dev *oc;

	oc = devm_kzalloc(&pdev->dev, sizeof(*oc), GFP_KERNEL);
	if (!oc)
		return -ENOMEM;
	oc->dev = &pdev->dev;

	oc->armpll = devm_clk_get(&pdev->dev, "armpll");
	if (IS_ERR(oc->armpll))
		return dev_err_probe(&pdev->dev, PTR_ERR(oc->armpll), "no armpll clock\n");

	oc->vproc = devm_regulator_get(&pdev->dev, "vproc");
	if (IS_ERR(oc->vproc))
		return dev_err_probe(&pdev->dev, PTR_ERR(oc->vproc), "no vproc regulator\n");

	platform_set_drvdata(pdev, oc);
	g_oc = oc;
	dev_info(&pdev->dev, "ocpanel_cpu ready: freq=%lu MHz vproc=%d mV (caps: %u MHz / %d mV)\n",
		 clk_get_rate(oc->armpll) / 1000000UL,
		 regulator_get_voltage(oc->vproc) / 1000,
		 OC_FREQ_MAX_MHZ, OC_UV_MAX / 1000);
	return 0;
}

static void oc_remove(struct platform_device *pdev)
{
	g_oc = NULL;
}

static const struct of_device_id oc_of_match[] = {
	{ .compatible = "ocpanel,cpu-control" },
	{ }
};
MODULE_DEVICE_TABLE(of, oc_of_match);

static struct platform_driver oc_driver = {
	.probe  = oc_probe,
	.remove = oc_remove,
	.driver = {
		.name           = "ocpanel-cpu",
		.of_match_table = oc_of_match,
		.dev_groups     = oc_groups,
	},
};
module_platform_driver(oc_driver);

MODULE_AUTHOR("Flerkies lab");
MODULE_DESCRIPTION("MT7988 CPU clock + core-voltage control (ocpanel)");
MODULE_LICENSE("GPL");
