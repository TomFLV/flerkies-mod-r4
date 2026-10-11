#!/bin/sh
# octhrottle - thermal auto-throttle for MT7988 via the ocpanel_cpu module.
# >= HI degC: step clock DOWN 100 MHz (voltage follows the safe curve -> linear toward stock).
# <= LO degC and below target: step back UP 100 MHz toward the user's set speed.
OCP=""
for d in /sys/devices/platform/ocpanel-cpu /sys/devices/platform/*ocpanel-cpu*; do
	[ -f "$d/freq_mhz" ] && { OCP="$d"; break; }
done
[ -z "$OCP" ] && { logger -t octhrottle "no ocpanel_cpu module; exiting"; exit 0; }

TZ=/sys/class/thermal/thermal_zone0/temp
TGT=/opt/bench/target_mhz
HI=${HI:-80000}      # throttle above 80 C
LO=${LO:-72000}      # restore below 72 C (hysteresis)
STEP=${STEP:-100}
FLOOR=${FLOOR:-1500}
POLL=${POLL:-4}

safe_volt() { # mv for a given mhz (matches backend curve)
	if   [ "$1" -le 2100 ]; then echo 900
	elif [ "$1" -le 2200 ]; then echo 1000
	elif [ "$1" -le 2300 ]; then echo 1050
	else echo 1100; fi
}
setspeed() { # <mhz> : volts-up-first when raising, freq-down-first when lowering
	M=$1; SV=$(safe_volt "$M"); C=$(cat "$OCP/freq_mhz")
	if [ "$M" -gt "$C" ]; then echo "$SV" > "$OCP/voltage_mv"; echo "$M" > "$OCP/freq_mhz"
	else echo "$M" > "$OCP/freq_mhz"; echo "$SV" > "$OCP/voltage_mv"; fi
}

logger -t octhrottle "started (HI=${HI}mC LO=${LO}mC step=${STEP} floor=${FLOOR})"
while :; do
	T=$(cat "$TZ" 2>/dev/null)
	TARGET=$(cat "$TGT" 2>/dev/null); [ -z "$TARGET" ] && TARGET=1900
	CUR=$(cat "$OCP/freq_mhz" 2>/dev/null)
	if [ -n "$T" ] && [ -n "$CUR" ]; then
		if [ "$T" -ge "$HI" ]; then
			NEW=$((CUR-STEP)); [ "$NEW" -lt "$FLOOR" ] && NEW=$FLOOR
			if [ "$NEW" -lt "$CUR" ]; then setspeed "$NEW"; logger -t octhrottle "THROTTLE $((T/1000))C ${CUR}->${NEW} MHz"; fi
		elif [ "$T" -le "$LO" ] && [ "$CUR" -lt "$TARGET" ]; then
			NEW=$((CUR+STEP)); [ "$NEW" -gt "$TARGET" ] && NEW=$TARGET
			setspeed "$NEW"; logger -t octhrottle "RESTORE $((T/1000))C ${CUR}->${NEW} MHz"
		fi
	fi
	sleep "$POLL"
done
