include $(TOPDIR)/rules.mk

PKG_NAME:=ocpanel-cpu
PKG_RELEASE:=1

include $(INCLUDE_DIR)/kernel.mk
include $(INCLUDE_DIR)/package.mk

define KernelPackage/ocpanel-cpu
  SUBMENU:=Other modules
  TITLE:=MT7988 CPU clock + core-voltage control (ocpanel)
  DEPENDS:=@TARGET_mediatek_filogic
  FILES:=$(PKG_BUILD_DIR)/ocpanel_cpu.ko
  AUTOLOAD:=$(call AutoLoad,99,ocpanel_cpu)
endef

define KernelPackage/ocpanel-cpu/description
  Clean CPU frequency and core-voltage control for MT7988 via the
  kernel clk and regulator frameworks (no raw register/I2C access).
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
	$(CP) ./src/* $(PKG_BUILD_DIR)/
endef

define Build/Compile
	+$(MAKE) $(PKG_JOBS) -C "$(LINUX_DIR)" \
		$(KERNEL_MAKE_FLAGS) \
		M="$(PKG_BUILD_DIR)" \
		modules
endef

$(eval $(call KernelPackage,ocpanel-cpu))
