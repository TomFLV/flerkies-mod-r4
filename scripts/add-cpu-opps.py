import re, glob, sys
fs = glob.glob('/home/tom/openwrt/build_dir/target-*/linux-mediatek_filogic/linux-*/arch/arm64/boot/dts/mediatek/mt7988a.dtsi')
if not fs: print('DTSI NOT FOUND'); sys.exit(1)
f = fs[0]; s = open(f).read()
if 'opp-1900000000' in s:
    print('already patched'); sys.exit(0)
pat = re.compile(r'(opp-1800000000\s*\{[^}]*\};)')
m = pat.search(s)
if not m: print('ANCHOR NOT FOUND'); sys.exit(1)
add = ''
for mhz in (1900,2000,2100,2200,2300,2400):
    hz = mhz*1000000
    add += "\n\t\t\topp-%d {\n\t\t\t\topp-hz = /bits/ 64 <%d>;\n\t\t\t\topp-microvolt = <900000>;\n\t\t\t};" % (hz,hz)
s = s[:m.end()] + add + s[m.end():]
open(f,'w').write(s)
print('PATCHED: added OPPs 1900-2400 MHz @ 900000uV (stock) to %s' % f.split('/')[-1])
