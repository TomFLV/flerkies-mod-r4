include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-ocpanel
PKG_VERSION:=1.0
PKG_RELEASE:=1
PKG_MAINTAINER:=Flerkies
PKG_LICENSE:=GPL-2.0

LUCI_TITLE:=Flerkies Mod - CPU overclock / control panel
LUCI_DEPENDS:=+kmod-ocpanel-cpu +stress-ng +luci-base
LUCI_PKGARCH:=all

include $(TOPDIR)/feeds/luci/luci.mk

# fall back to a plain package build if luci.mk is unavailable
# (this repo is normally built inside an OpenWrt tree with the luci feed)
