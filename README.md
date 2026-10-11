# Flerkies Mod for the Banana Pi BPI-R4

A custom [OpenWrt](https://openwrt.org/) build for the **Banana Pi BPI-R4**
(MediaTek MT7988A / Filogic 880), focused on a fast, low-latency router with
full **CPU control, benchmarking and thermal safety** built into the web UI.

> Built on OpenWrt. This project only adds packages, a device-tree tweak and
> config on top of upstream OpenWrt — it ships **no credentials and no personal
> data**. Stock OpenWrt behaviour applies: `root` has **no password** on first
> boot; set one in LuCI (System → Administration) or with `passwd`.

## What it adds

- **`kmod-ocpanel-cpu`** — a small kernel module exposing live CPU **frequency**
  and **core voltage** control via sysfs, using the kernel `clk` and `regulator`
  frameworks (no raw register/`/dev/mem` pokes). Hard-capped at 2500 MHz / 1100 mV.
- **`luci-app-ocpanel`** — an "Overclocking" tab under System with:
  - live readouts (speed, voltage, temperature, per-core load) + CPU temp graph,
  - speed selector with an auto-applied safe voltage curve,
  - **always-on thermal auto-throttle** (steps the clock down above 80 °C),
  - a **combined CPU + RAM stability benchmark** (stress-ng + CoreMark) with a
    selectable 1–4 cores and 30 s–1 h duration, early abort on data/memory
    errors or overheat, and a benchmark history.
- **CPU OPP extension** — device-tree operating points up to 2.4 GHz
  (`scripts/add-cpu-opps.py`), so higher clocks are selectable (stock = 1.5 GHz,
  rated max = 1.8 GHz; above ~2.1 GHz needs more voltage).
- **`ocsafe`** — sets a sane default clock at boot.

## Build

Builds inside an OpenWrt source tree:

```sh
git clone https://github.com/openwrt/openwrt.git
cd openwrt
./scripts/feeds update -a && ./scripts/feeds install -a
# add this repo's packages + files
cp -r /path/to/flerkies-mod-r4/package/* package/
cp -r /path/to/flerkies-mod-r4/files .
# apply the CPU OPP device-tree extension
make target/linux/{clean,prepare} V=s QUILT=1   # or build once, then:
python3 /path/to/flerkies-mod-r4/scripts/add-cpu-opps.py
# config + build
cp /path/to/flerkies-mod-r4/config/bpi-r4.config .config
make defconfig
make -j$(nproc)
```

Target: `mediatek/filogic`, device `bananapi_bpi-r4`.
Images land in `bin/targets/mediatek/filogic/`.

## Channels / updates

- **stable** — verified releases.
- **beta** — new builds (incl. fresh upstream OpenWrt snapshots) pending verification.

See `docs/` for the OTA update manifest format.

## License

GPL-2.0, matching OpenWrt and LuCI. The `ocpanel_cpu` module is GPL-2.0.
