#!/bin/sh
# soak.sh <seconds> - combined CPU + RAM stability benchmark with early abort.
# Runs stress-ng CPU (all methods) + RAM (vm, --verify) SIMULTANEOUSLY.
# Aborts BEFORE a crash on: overheat, or any detected data/memory error.
# Reports CoreMark score (only if fully clean), memory errors, temps, verdict.
SECS="${1:-60}"
CORES="${2:-4}"; [ "$CORES" -lt 1 ] 2>/dev/null && CORES=4; [ "$CORES" -gt 4 ] 2>/dev/null && CORES=4
LASTCORE=$((CORES-1))
RES=/opt/bench/results; mkdir -p "$RES"; CUR="$RES/current.json"
OCP=""; for d in /sys/devices/platform/ocpanel-cpu /sys/devices/platform/*ocpanel-cpu*; do [ -f "$d/freq_mhz" ] && { OCP="$d"; break; }; done
MEMMB=$(awk '/^MemTotal/{print int($2/1024)}' /proc/meminfo)
TMAX=${TMAX:-92}          # abort before thermal crash (critical trip is 125C)
LOG=/tmp/stab.log; : > "$LOG"
rdt(){ echo $(( $(cat /sys/class/thermal/thermal_zone0/temp)/1000 )); }
rdf(){ if [ -n "$OCP" ]; then cat "$OCP/freq_mhz"; else echo 0; fi; }
rdv(){ if [ -n "$OCP" ]; then cat "$OCP/voltage_mv"; else echo 0; fi; }

START=$(date +%s); F0=$(rdf); V0=$(rdv)
TPEAK=0; TSUM=0; TN=0; ABORT=""
echo "{\"running\":true,\"elapsed\":0,\"duration\":$SECS,\"speed_mhz\":$F0,\"voltage_mv\":$V0,\"temp_c\":$(rdt),\"mem_mb\":$MEMMB,\"phase\":\"bandwidth\"}" > "$CUR"

# quick memory bandwidth (STREAM triad), reported in MB/s
BWS=5; [ "$SECS" -lt 12 ] && BWS=3
BW=$(stress-ng --stream 4 --metrics-brief -t ${BWS}s 2>&1 | grep -iE 'MB per sec|memory rate' | grep -oE '[0-9]+\.[0-9]+' | sort -rn | head -1)
[ -z "$BW" ] && BW=0

# combined CPU (N cores pinned, all methods) + RAM (2 vm workers over 60% RAM, verified)
stress-ng --cpu "$CORES" --taskset 0-$LASTCORE --cpu-method all --vm 2 --vm-bytes 60% --vm-method all --verify --metrics-brief -t ${SECS}s > "$LOG" 2>&1 &
SPID=$!
while kill -0 "$SPID" 2>/dev/null; do
	T=$(rdt); [ "$T" -gt "$TPEAK" ] && TPEAK=$T; TSUM=$((TSUM+T)); TN=$((TN+1))
	# thermal safety abort (before the system cooks)
	if [ "$T" -ge "$TMAX" ]; then kill "$SPID" 2>/dev/null; ABORT="OVERHEAT ${T}C"; break; fi
	# data/memory error abort (catch instability before a hard crash)
	if grep -qiE 'fail:|corrupt|mismatch|miscompare|data integrity' "$LOG"; then kill "$SPID" 2>/dev/null; ABORT="DATA ERROR"; break; fi
	EL=$(( $(date +%s) - START ))
	echo "{\"running\":true,\"elapsed\":$EL,\"duration\":$SECS,\"speed_mhz\":$(rdf),\"voltage_mv\":$(rdv),\"temp_c\":$T,\"temp_peak\":$TPEAK,\"mem_mb\":$MEMMB}" > "$CUR"
	sleep 2
done
wait "$SPID" 2>/dev/null; RC=$?
EL=$(( $(date +%s) - START ))
ERRS=$(grep -icE 'fail:|corrupt|mismatch|miscompare' "$LOG")
F1=$(rdf); V1=$(rdv); T1=$(rdt); [ "$T1" -gt "$TPEAK" ] && TPEAK=$T1
if [ "$TN" -gt 0 ]; then TAVG=$((TSUM/TN)); else TAVG=$T1; fi

SCORE=0; CM=0
if [ -z "$ABORT" ] && [ "$RC" -eq 0 ] && [ "$ERRS" -eq 0 ]; then
	CMO=$(taskset -c 0-$LASTCORE /opt/bench/coremark_mt 2>/dev/null); CM=$(echo "$CMO" | grep -i 'CoreMark 1.0' | awk '{print $4}')
	SCORE=$(awk "BEGIN{printf \"%d\", ${CM:-0}/10}")
	STABLE=PASS
elif [ -n "$ABORT" ]; then STABLE="ABORTED"
else STABLE=FAIL; fi

TS=$(date '+%Y-%m-%d %H:%M')
cat > "$CUR" <<J
{"running":false,"done":true,"score":$SCORE,"coremark":${CM:-0},"cores":$CORES,"speed_mhz":$F1,"voltage_mv":$V1,"temp_avg":$TAVG,"temp_peak":$TPEAK,"mem_mb":$MEMMB,"ram_mbps":$BW,"errors":$ERRS,"duration_s":$SECS,"elapsed_s":$EL,"abort":"$ABORT","stable":"$STABLE"}
J
echo "{\"ts\":\"$TS\",\"type\":\"cpu+ram\",\"score\":$SCORE,\"cores\":$CORES,\"speed_mhz\":$F1,\"voltage_mv\":$V1,\"temp_peak\":$TPEAK,\"ram_mbps\":$BW,\"errors\":$ERRS,\"duration_s\":$EL,\"stable\":\"$STABLE\"}" >> "$RES/history.jsonl"
sync
