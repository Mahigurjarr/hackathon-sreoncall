#!/bin/bash
# SREonCall Security Metrics — Conntrack & File Integrity
# Outputs Prometheus textfile format for node_exporter
#
# Install as a cron job (runs every minute):
#   sudo cp conntrack-metrics.sh /opt/sreoncall-agent/scripts/
#   sudo chmod +x /opt/sreoncall-agent/scripts/conntrack-metrics.sh
#   sudo mkdir -p /var/lib/node_exporter/textfile
#
# /etc/cron.d/sreoncall-security:
#   * * * * * root /opt/sreoncall-agent/scripts/conntrack-metrics.sh > \
#                  /var/lib/node_exporter/textfile/conntrack.prom

# Count outbound connections by destination port (top 20 ports)
echo "# HELP sreoncall_outbound_connections Active outbound TCP connections by destination port"
echo "# TYPE sreoncall_outbound_connections gauge"
ss -tn state established '( sport != :22 and sport != :80 and sport != :443 )' 2>/dev/null | \
  awk 'NR>1 {split($4,a,":"); print a[length(a)]}' | sort | uniq -c | sort -rn | head -20 | \
  while read count port; do
    echo "sreoncall_outbound_connections{dest_port=\"${port}\"} ${count}"
  done

# Count total listening ports
echo "# HELP sreoncall_listening_ports_total Total number of listening TCP ports"
echo "# TYPE sreoncall_listening_ports_total gauge"
LISTEN_COUNT=$(ss -tln 2>/dev/null | tail -n +2 | wc -l)
echo "sreoncall_listening_ports_total ${LISTEN_COUNT}"

# Count executables in /tmp, /var/tmp, /dev/shm
echo "# HELP sreoncall_tmp_executables_total Executable files in temp directories"
echo "# TYPE sreoncall_tmp_executables_total gauge"
TMP_EXEC=$(find /tmp /var/tmp /dev/shm -type f -executable 2>/dev/null | wc -l)
echo "sreoncall_tmp_executables_total ${TMP_EXEC}"

# Count crontab entries for non-root users
echo "# HELP sreoncall_user_crontab_entries Total crontab entries for non-root users"
echo "# TYPE sreoncall_user_crontab_entries gauge"
CRON_COUNT=0
for user in $(ls /var/spool/cron/crontabs/ 2>/dev/null); do
  if [ "$user" != "root" ]; then
    ENTRIES=$(grep -v '^#\|^$' "/var/spool/cron/crontabs/$user" 2>/dev/null | wc -l)
    CRON_COUNT=$((CRON_COUNT + ENTRIES))
  fi
done
echo "sreoncall_user_crontab_entries ${CRON_COUNT}"

# Known cryptominer process detection
echo "# HELP sreoncall_cryptominer_detected Whether a known cryptominer process is running (0/1)"
echo "# TYPE sreoncall_cryptominer_detected gauge"
if pgrep -f 'xmrig|minerd|cpuminer|cgminer|bfgminer|ethminer|cryptonight|stratum\+tcp' > /dev/null 2>&1; then
  echo "sreoncall_cryptominer_detected 1"
else
  echo "sreoncall_cryptominer_detected 0"
fi

# SUID/SGID binary count
echo "# HELP sreoncall_suid_binaries_total Total SUID/SGID binaries on filesystem"
echo "# TYPE sreoncall_suid_binaries_total gauge"
SUID_COUNT=$(find / -type f \( -perm -4000 -o -perm -2000 \) -not -path "/proc/*" -not -path "/sys/*" 2>/dev/null | wc -l)
echo "sreoncall_suid_binaries_total ${SUID_COUNT}"

# Authorized keys count per user
echo "# HELP sreoncall_authorized_keys_total SSH authorized_keys entries per user"
echo "# TYPE sreoncall_authorized_keys_total gauge"
for home_dir in /home/* /root; do
  if [ -f "${home_dir}/.ssh/authorized_keys" ]; then
    user=$(basename "$home_dir")
    KEY_COUNT=$(grep -c '^ssh-' "${home_dir}/.ssh/authorized_keys" 2>/dev/null || echo 0)
    echo "sreoncall_authorized_keys_total{user=\"${user}\"} ${KEY_COUNT}"
  fi
done

# World-writable files in sensitive directories
echo "# HELP sreoncall_world_writable_sensitive Total world-writable files in sensitive directories"
echo "# TYPE sreoncall_world_writable_sensitive gauge"
WW_COUNT=$(find /etc /usr/bin /usr/sbin /usr/local/bin -type f -perm -o+w 2>/dev/null | wc -l)
echo "sreoncall_world_writable_sensitive ${WW_COUNT}"

# Running processes from temp directories
echo "# HELP sreoncall_tmp_running_processes Processes running from temp directories"
echo "# TYPE sreoncall_tmp_running_processes gauge"
TMP_PROCS=$(find /proc/*/exe -maxdepth 0 2>/dev/null | while read exe; do
  readlink "$exe" 2>/dev/null
done | grep -c -E '^/(tmp|var/tmp|dev/shm)/' 2>/dev/null || echo 0)
echo "sreoncall_tmp_running_processes ${TMP_PROCS}"
