#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Debian 13 VPS Hardening + Docker Host Bootstrap
# Idempotent-ish: safe to re-run if parts already exist.
#
# Target:
#   Debian 13 "trixie"
#
# Goal:
#   - secure baseline host
#   - Docker Engine + Docker Compose plugin installed
#   - no containers deployed
#   - ready for Docker-based workloads under /opt/stacks
#
# Usage:
#   sudo ./harden-debian-vps.sh --user matthias
#   sudo ./harden-debian-vps.sh --user matthias --ssh-port 2222
#   sudo ./harden-debian-vps.sh --user matthias --no-auto-reboot
# ==============================================================================

ADMIN_USER=""
SSH_PORT="22"
KEEP_SSH_PORT_22="true"
STACKS_DIR="/opt/stacks"
ENABLE_AUTOMATIC_REBOOT="true"
INSTALL_DOCKER="true"
RUN_SYSTEM_UPGRADE="true"
INTERACTIVE="true"
EXISTING_SSH_PORT=""

DOCKER_DAEMON_JSON="/etc/docker/daemon.json"
SSH_HARDENING_FILE="/etc/ssh/sshd_config.d/999-hardening.conf"
SYSCTL_HARDENING_FILE="/etc/sysctl.d/99-vps-hardening.conf"
FAIL2BAN_SSHD_FILE="/etc/fail2ban/jail.d/sshd.local"

CHECK_FAILED=0
CHECK_WARNINGS=0

log() {
  printf '\n\033[1;34m[INFO]\033[0m %s\n' "$*"
}

ok() {
  printf '\033[1;32m[OK]\033[0m %s\n' "$*"
}

warn() {
  CHECK_WARNINGS=$((CHECK_WARNINGS + 1))
  printf '\033[1;33m[WARN]\033[0m %s\n' "$*"
}

fail() {
  CHECK_FAILED=$((CHECK_FAILED + 1))
  printf '\033[1;31m[FAIL]\033[0m %s\n' "$*" >&2
}

err() {
  printf '\n\033[1;31m[ERROR]\033[0m %s\n' "$*" >&2
}

usage() {
  cat <<'EOF'
Usage:
  sudo ./harden-debian-vps.sh [options]

Options:
  -u, --user USER                 Admin username to create/use
  -p, --ssh-port PORT             SSH port, default: 22
      --stacks-dir DIR            Docker stacks directory, default: /opt/stacks
      --no-auto-reboot            Disable unattended-upgrades automatic reboot
      --no-docker                 Do not install Docker
      --no-upgrade                Do not run apt full-upgrade
      --non-interactive           Do not ask questions; requires --user

Behavior:
  - Port 22 stays enabled as SSH fallback to avoid lockout
  - The currently detected SSH port is also kept during migration when possible
  - If systemd SSH socket activation exists, it is disabled so sshd itself binds the ports
  -h, --help                      Show help

Examples:
  sudo ./harden-debian-vps.sh --user matthias
  sudo ./harden-debian-vps.sh --user matthias --ssh-port 2222
  sudo ./harden-debian-vps.sh --user matthias --no-auto-reboot
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -u|--user)
        ADMIN_USER="${2:-}"
        shift 2
        ;;
      -p|--ssh-port)
        SSH_PORT="${2:-}"
        shift 2
        ;;
      --stacks-dir)
        STACKS_DIR="${2:-}"
        shift 2
        ;;
      --no-auto-reboot)
        ENABLE_AUTOMATIC_REBOOT="false"
        shift
        ;;
      --no-docker)
        INSTALL_DOCKER="false"
        shift
        ;;
      --no-upgrade)
        RUN_SYSTEM_UPGRADE="false"
        shift
        ;;
      --non-interactive)
        INTERACTIVE="false"
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        err "Unbekannter Parameter: $1"
        usage
        exit 1
        ;;
    esac
  done
}

prompt_missing_args() {
  if [[ -z "${ADMIN_USER}" ]]; then
    if [[ "${INTERACTIVE}" != "true" ]]; then
      err "--user ist im non-interactive mode erforderlich."
      exit 1
    fi

    read -rp "Admin username [matthias]: " ADMIN_USER
    ADMIN_USER="${ADMIN_USER:-matthias}"
  fi

  if [[ -z "${SSH_PORT}" ]]; then
    if [[ "${INTERACTIVE}" != "true" ]]; then
      err "--ssh-port darf nicht leer sein."
      exit 1
    fi

    read -rp "SSH port [22]: " SSH_PORT
    SSH_PORT="${SSH_PORT:-22}"
  fi
}

validate_args() {
  if [[ ! "${ADMIN_USER}" =~ ^[a-z_][a-z0-9_-]*[$]?$ ]]; then
    err "Ungültiger Linux-Username: ${ADMIN_USER}"
    exit 1
  fi

  if [[ ! "${SSH_PORT}" =~ ^[0-9]+$ ]] || (( SSH_PORT < 1 || SSH_PORT > 65535 )); then
    err "Ungültiger SSH-Port: ${SSH_PORT}"
    exit 1
  fi

  if [[ -z "${STACKS_DIR}" || "${STACKS_DIR}" != /* ]]; then
    err "--stacks-dir muss ein absoluter Pfad sein."
    exit 1
  fi
}

write_file_if_changed() {
  local target="$1"
  local mode="${2:-0644}"
  local tmp

  tmp="$(mktemp)"
  cat >"${tmp}"

  if [[ -f "${target}" ]] && cmp -s "${tmp}" "${target}"; then
    rm -f "${tmp}"
    log "Unverändert: ${target}"
    return 1
  fi

  install -D -m "${mode}" "${tmp}" "${target}"
  rm -f "${tmp}"
  log "Aktualisiert: ${target}"
  return 0
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    err "Bitte als root ausführen, z. B. mit sudo."
    exit 1
  fi
}

detect_debian() {
  if [[ ! -f /etc/os-release ]]; then
    err "/etc/os-release nicht gefunden."
    exit 1
  fi

  # shellcheck disable=SC1091
  source /etc/os-release

  log "System erkannt: ${PRETTY_NAME:-unknown}"

  if [[ "${ID:-}" != "debian" ]]; then
    warn "Dieses Script ist für Debian 13 gedacht. Aktuelles System: ${PRETTY_NAME:-unknown}"
  fi

  if [[ "${VERSION_ID:-}" != "13" ]]; then
    warn "Erwartet wurde Debian 13. Aktuelle VERSION_ID: ${VERSION_ID:-unknown}"
  fi

  if [[ "${VERSION_CODENAME:-}" != "trixie" ]]; then
    warn "Erwartet wurde Codename trixie. Aktueller Codename: ${VERSION_CODENAME:-unknown}"
  fi
}

apt_update_once() {
  log "Aktualisiere APT-Paketindex."
  apt-get update
}

update_system() {
  if [[ "${RUN_SYSTEM_UPGRADE}" != "true" ]]; then
    log "Systemupgrade übersprungen."
    return
  fi

  log "Aktualisiere Systempakete."
  DEBIAN_FRONTEND=noninteractive apt-get full-upgrade -y
}

install_packages() {
  local packages=("$@")

  log "Installiere Pakete falls nötig: ${packages[*]}"
  DEBIAN_FRONTEND=noninteractive apt-get install -y "${packages[@]}"
}

install_base_packages() {
  install_packages \
    sudo \
    openssh-server \
    ca-certificates \
    curl \
    wget \
    git \
    htop \
    jq \
    gnupg \
    lsb-release \
    apt-transport-https \
    ufw \
    fail2ban \
    unattended-upgrades \
    apt-listchanges \
    chrony \
    logrotate \
    needrestart \
    nano \
    vim \
    rsync \
    unzip \
    tar \
    restic \
    rclone
}

verify_ssh_installation() {
  if ! command -v sshd >/dev/null 2>&1; then
    err "'sshd' wurde nicht gefunden. Prüfe, ob openssh-server erfolgreich installiert wurde."
    exit 1
  fi

  if [[ -z "$(ssh_service_name || true)" ]]; then
    err "Kein ssh/sshd systemd service gefunden, obwohl openssh-server installiert sein sollte."
    err "Verfügbare SSH-bezogene Units:"
    systemctl list-unit-files --type=service --no-legend 2>/dev/null | grep -E '^(ssh|sshd)' || true
    systemctl list-unit-files --type=socket --no-legend 2>/dev/null | grep -E '^(ssh|sshd)' || true
    exit 1
  fi
}

capture_existing_ssh_port() {
  if command -v sshd >/dev/null 2>&1; then
    EXISTING_SSH_PORT="$(sshd -T 2>/dev/null | awk '/^port / { print $2; exit }' || true)"
  fi

  if [[ -z "${EXISTING_SSH_PORT}" ]]; then
    EXISTING_SSH_PORT="22"
  fi

  log "Aktueller SSH-Port vor Änderungen: ${EXISTING_SSH_PORT}"
}

list_ssh_ports() {
  local ports=("${SSH_PORT}" "${EXISTING_SSH_PORT}")

  if [[ "${KEEP_SSH_PORT_22}" == "true" ]]; then
    ports+=("22")
  fi

  printf '%s\n' "${ports[@]}" | awk 'NF && !seen[$0]++'
}

ssh_ports_csv() {
  paste -sd, <(list_ssh_ports)
}

render_ssh_port_lines() {
  local port

  while IFS= read -r port; do
    printf 'Port %s\n' "${port}"
  done < <(list_ssh_ports)
}

merge_authorized_keys() {
  local source_file="$1"
  local target_file="$2"
  local owner_user="$3"
  local owner_group="$4"
  local tmp_file

  tmp_file="$(mktemp)"
  touch "${target_file}"
  awk 'NF && !seen[$0]++' "${target_file}" "${source_file}" >"${tmp_file}"
  install -m 600 -o "${owner_user}" -g "${owner_group}" "${tmp_file}" "${target_file}"
  rm -f "${tmp_file}"
}

create_admin_user() {
  local user_ssh_dir="/home/${ADMIN_USER}/.ssh"
  local user_keys="${user_ssh_dir}/authorized_keys"

  if id "${ADMIN_USER}" &>/dev/null; then
    log "User existiert bereits: ${ADMIN_USER}"
  else
    log "Lege Admin-User an: ${ADMIN_USER}"
    adduser --disabled-password --gecos "" "${ADMIN_USER}"
  fi

  if id -nG "${ADMIN_USER}" | tr ' ' '\n' | grep -qx sudo; then
    log "User '${ADMIN_USER}' ist bereits in Gruppe sudo."
  else
    log "Füge '${ADMIN_USER}' zur Gruppe sudo hinzu."
    usermod -aG sudo "${ADMIN_USER}"
  fi

  install -d -m 700 -o "${ADMIN_USER}" -g "${ADMIN_USER}" "${user_ssh_dir}"

  if [[ -f /root/.ssh/authorized_keys ]]; then
    log "Übernehme root authorized_keys nach '${ADMIN_USER}' (ohne vorhandene Keys zu überschreiben)."
    merge_authorized_keys /root/.ssh/authorized_keys "${user_keys}" "${ADMIN_USER}" "${ADMIN_USER}"
  fi

  if [[ ! -s "${user_keys}" ]]; then
    err "Kein SSH-Key für '${ADMIN_USER}' gefunden. Breche ab, bevor SSH-Hardening den Zugang sperrt."
    err "Lege zuerst einen gültigen Public Key in ${user_keys} ab und starte das Script erneut."
    exit 1
  fi

  chown "${ADMIN_USER}:${ADMIN_USER}" "${user_keys}"
  chmod 600 "${user_keys}"
}

configure_sudo() {
  log "Konfiguriere sudo für Admin-User."

  local sudoers_file="/etc/sudoers.d/90-${ADMIN_USER}"

  write_file_if_changed "${sudoers_file}" 0440 <<EOF || true
${ADMIN_USER} ALL=(ALL:ALL) ALL
EOF

  chmod 440 "${sudoers_file}"
  visudo -cf "${sudoers_file}" >/dev/null
}

ssh_service_name() {
  if systemctl list-unit-files | grep -q '^ssh.service'; then
    printf 'ssh\n'
  elif systemctl list-unit-files | grep -q '^sshd.service'; then
    printf 'sshd\n'
  fi
}

ssh_socket_names() {
  systemctl list-unit-files --type=socket --no-legend 2>/dev/null \
    | awk '/^(ssh|sshd)\.socket/ { print $1 }'
}

disable_ssh_socket_activation() {
  local socket
  local found=0

  while IFS= read -r socket; do
    [[ -z "${socket}" ]] && continue
    found=1
    log "Deaktiviere SSH socket activation: ${socket}"
    systemctl disable --now "${socket}" || true
  done < <(ssh_socket_names)

  if [[ "${found}" -eq 0 ]]; then
    log "Keine SSH socket activation gefunden."
  fi
}

port_is_listening() {
  local port="$1"

  ss -tlnH | awk '{print $4}' | sed -E 's/.*:([0-9]+)$/\1/' | grep -qx "${port}"
}

ensure_ssh_ports_listening() {
  local port
  local missing_ports=()

  while IFS= read -r port; do
    if port_is_listening "${port}"; then
      ok "SSH lauscht auf TCP-Port ${port}"
    else
      missing_ports+=("${port}")
    fi
  done < <(list_ssh_ports)

  if (( ${#missing_ports[@]} > 0 )); then
    err "SSH lauscht nicht auf erwarteten Ports: ${missing_ports[*]}"
    err "Das ist ein Lockout-Risiko. Prüfe 'systemctl status ssh', 'journalctl -u ssh -b' und 'ss -tlnp'."
    exit 1
  fi
}

enable_and_restart_ssh_service() {
  local service

  service="$(ssh_service_name || true)"

  if [[ -z "${service}" ]]; then
    err "Kein ssh/sshd systemd service gefunden. Abbruch, um SSH-Lockout zu vermeiden."
    systemctl list-unit-files --type=service --no-legend 2>/dev/null | grep -E '^(ssh|sshd)' || true
    systemctl list-unit-files --type=socket --no-legend 2>/dev/null | grep -E '^(ssh|sshd)' || true
    exit 1
  fi

  systemctl enable "${service}"
  systemctl restart "${service}"
}

configure_ssh() {
  log "Konfiguriere SSH-Hardening."

  local changed=0

  install -d -m 755 /etc/ssh/sshd_config.d

  if write_file_if_changed "${SSH_HARDENING_FILE}" 0644 <<EOF
$(render_ssh_port_lines)

PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no

PubkeyAuthentication yes
AuthenticationMethods publickey

X11Forwarding no
AllowAgentForwarding no
AllowTcpForwarding no

MaxAuthTries 3
LoginGraceTime 20

ClientAliveInterval 300
ClientAliveCountMax 2

UsePAM yes
EOF
  then
    changed=1
  fi

  sshd -t

  disable_ssh_socket_activation
  enable_and_restart_ssh_service
  ensure_ssh_ports_listening

  if [[ "${changed}" -eq 1 ]]; then
    log "SSH-Konfiguration geändert und neu geladen."
  else
    log "SSH-Konfiguration unverändert."
  fi

  log "Effektive SSH-Werte:"
  sshd -T | grep -E '^(port|permitrootlogin|passwordauthentication|kbdinteractiveauthentication|challengeresponseauthentication|authenticationmethods|maxauthtries|allowtcpforwarding|allowagentforwarding)' || true

  if [[ "${SSH_PORT}" != "22" ]]; then
    warn "Bei benutzerdefiniertem SSH-Port muss ggf. zusätzlich die Firewall des VPS-/Cloud-Anbieters angepasst werden."
  fi

  if [[ "${SSH_PORT}" != "22" && "${KEEP_SSH_PORT_22}" == "true" ]]; then
    warn "Port 22 bleibt absichtlich als Fallback aktiv, um Lockouts bei Port-Migrationen zu vermeiden."
  fi
}

configure_firewall() {
  local changed=0
  local port

  log "Konfiguriere UFW idempotent."

  ufw default deny incoming
  ufw default allow outgoing

  while IFS= read -r port; do
    if ufw allow "${port}/tcp" >/dev/null; then
      changed=1
    fi
  done < <(list_ssh_ports)

  ufw allow 80/tcp >/dev/null || true
  ufw allow 443/tcp >/dev/null || true

  ufw --force enable >/dev/null

  if [[ "${changed}" -eq 1 ]]; then
    log "UFW-Regeln aktualisiert."
  else
    log "UFW-Regeln geprüft."
  fi
}

configure_fail2ban() {
  log "Konfiguriere Fail2ban für SSH."

  local changed=0

  if write_file_if_changed "${FAIL2BAN_SSHD_FILE}" 0644 <<EOF
[sshd]
enabled = true
backend = systemd
port = $(ssh_ports_csv)
maxretry = 3
findtime = 10m
bantime = 1h
EOF
  then
    changed=1
  fi

  systemctl enable --now fail2ban

  if [[ "${changed}" -eq 1 ]]; then
    log "Fail2ban-Konfiguration geändert. Starte Fail2ban neu."
    systemctl restart fail2ban
  else
    log "Fail2ban-Konfiguration unverändert."
  fi
}

configure_unattended_upgrades() {
  log "Konfiguriere automatische Security-Updates."

  write_file_if_changed /etc/apt/apt.conf.d/20auto-upgrades 0644 <<'EOF' || true
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF

  if [[ "${ENABLE_AUTOMATIC_REBOOT}" == "true" ]]; then
    write_file_if_changed /etc/apt/apt.conf.d/51unattended-reboot 0644 <<'EOF' || true
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";
EOF
  else
    write_file_if_changed /etc/apt/apt.conf.d/51unattended-reboot 0644 <<'EOF' || true
Unattended-Upgrade::Automatic-Reboot "false";
EOF
  fi

  systemctl enable --now unattended-upgrades || true
  systemctl restart unattended-upgrades || true
}

configure_chrony() {
  log "Aktiviere chrony."
  systemctl enable --now chrony
}

remove_conflicting_docker_packages() {
  log "Entferne potenziell konflikthafte Docker-Pakete, falls vorhanden."

  apt-get remove -y \
    docker.io \
    docker-doc \
    docker-compose \
    docker-compose-v2 \
    podman-docker \
    containerd \
    runc \
    2>/dev/null || true
}

configure_docker_apt_repo() {
  log "Konfiguriere offizielles Docker-APT-Repository."

  install -m 0755 -d /etc/apt/keyrings

  if [[ ! -f /etc/apt/keyrings/docker.asc ]]; then
    log "Lade Docker GPG-Key."
    curl -fsSL https://download.docker.com/linux/debian/gpg \
      -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
  else
    log "Docker GPG-Key existiert bereits."
  fi

  # shellcheck disable=SC1091
  source /etc/os-release

  local repo_file="/etc/apt/sources.list.d/docker.list"
  local repo_line

  repo_line="deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian ${VERSION_CODENAME} stable"

  if [[ -f "${repo_file}" ]] && grep -Fxq "${repo_line}" "${repo_file}"; then
    log "Docker APT-Repository ist bereits korrekt gesetzt."
  else
    log "Setze Docker APT-Repository."
    printf '%s\n' "${repo_line}" >"${repo_file}"
  fi

  apt-get update
}

install_docker_engine() {
  if [[ "${INSTALL_DOCKER}" != "true" ]]; then
    log "Docker-Installation übersprungen."
    return
  fi

  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log "Docker + Compose Plugin sind bereits installiert."
  else
    remove_conflicting_docker_packages
    configure_docker_apt_repo

    install_packages \
      docker-ce \
      docker-ce-cli \
      containerd.io \
      docker-buildx-plugin \
      docker-compose-plugin
  fi

  systemctl enable --now docker

  if id -nG "${ADMIN_USER}" | tr ' ' '\n' | grep -qx docker; then
    log "User '${ADMIN_USER}' ist bereits in Gruppe docker."
  else
    log "Füge '${ADMIN_USER}' zur Gruppe docker hinzu."
    usermod -aG docker "${ADMIN_USER}"
  fi
}

configure_docker_daemon() {
  if [[ "${INSTALL_DOCKER}" != "true" ]]; then
    return
  fi

  log "Konfiguriere Docker Daemon Baseline."

  local changed=0

  install -d -m 755 /etc/docker

  if write_file_if_changed "${DOCKER_DAEMON_JSON}" 0644 <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "live-restore": true,
  "userland-proxy": false,
  "no-new-privileges": true
}
EOF
  then
    changed=1
  fi

  if [[ "${changed}" -eq 1 ]]; then
    log "Docker Daemon-Konfiguration geändert. Starte Docker neu."
    systemctl restart docker
  else
    log "Docker Daemon-Konfiguration unverändert."
  fi
}

prepare_filesystem_layout() {
  log "Bereite Dateisystemlayout vor."

  install -d -m 755 -o "${ADMIN_USER}" -g "${ADMIN_USER}" "${STACKS_DIR}"
  install -d -m 750 -o "${ADMIN_USER}" -g "${ADMIN_USER}" /opt/scripts
  install -d -m 750 -o root -g root /opt/backups

  log "Vorbereitet:"
  log "  ${STACKS_DIR}"
  log "  /opt/scripts"
  log "  /opt/backups"
}

apply_sysctl_hardening() {
  log "Setze Docker-kompatibles Basis-sysctl-Hardening."

  local changed=0

  if write_file_if_changed "${SYSCTL_HARDENING_FILE}" 0644 <<'EOF'
# Basic network hardening, Docker-compatible.
# Do not set net.ipv4.ip_forward=0 on Docker hosts.

net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0

net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0

net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
net.ipv6.conf.all.accept_source_route = 0
net.ipv6.conf.default.accept_source_route = 0

net.ipv4.icmp_echo_ignore_broadcasts = 1

net.ipv4.conf.all.log_martians = 1

net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1

kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1

fs.protected_hardlinks = 1
fs.protected_symlinks = 1
EOF
  then
    changed=1
  fi

  if [[ "${changed}" -eq 1 ]]; then
    log "Sysctl-Konfiguration geändert. Wende Einstellungen an."
    sysctl --system >/dev/null
  else
    log "Sysctl-Konfiguration unverändert."
  fi
}

# ==============================================================================
# System checks
# ==============================================================================

check_command_exists() {
  local cmd="$1"

  if command -v "${cmd}" >/dev/null 2>&1; then
    ok "Command vorhanden: ${cmd}"
  else
    fail "Command fehlt: ${cmd}"
  fi
}

check_service_active() {
  local service="$1"

  if systemctl is-active --quiet "${service}"; then
    ok "Service aktiv: ${service}"
  else
    fail "Service nicht aktiv: ${service}"
  fi
}

check_service_enabled() {
  local service="$1"

  if systemctl is-enabled --quiet "${service}" 2>/dev/null; then
    ok "Service enabled: ${service}"
  else
    fail "Service nicht enabled: ${service}"
  fi
}

check_user_and_groups() {
  log "Check: User und Gruppen"

  if id "${ADMIN_USER}" >/dev/null 2>&1; then
    ok "User existiert: ${ADMIN_USER}"
  else
    fail "User fehlt: ${ADMIN_USER}"
    return
  fi

  if id -nG "${ADMIN_USER}" | tr ' ' '\n' | grep -qx sudo; then
    ok "User ist in sudo-Gruppe: ${ADMIN_USER}"
  else
    fail "User ist nicht in sudo-Gruppe: ${ADMIN_USER}"
  fi

  if [[ "${INSTALL_DOCKER}" == "true" ]]; then
    if id -nG "${ADMIN_USER}" | tr ' ' '\n' | grep -qx docker; then
      ok "User ist in docker-Gruppe: ${ADMIN_USER}"
    else
      fail "User ist nicht in docker-Gruppe: ${ADMIN_USER}"
    fi
  fi

  if [[ -s "/home/${ADMIN_USER}/.ssh/authorized_keys" ]]; then
    ok "authorized_keys vorhanden für ${ADMIN_USER}"
  else
    fail "authorized_keys fehlt oder ist leer für ${ADMIN_USER}"
  fi
}

check_ssh_effective_config() {
  local effective
  local port
  local ssh_service
  local socket

  log "Check: SSH effektive Konfiguration"

  if ! sshd -t; then
    fail "sshd_config Syntax ist ungültig"
    return
  fi

  ok "sshd_config Syntax gültig"

  ssh_service="$(ssh_service_name || true)"
  if [[ -n "${ssh_service}" ]]; then
    check_service_active "${ssh_service}"
    check_service_enabled "${ssh_service}"
  else
    fail "Kein ssh/sshd systemd service gefunden"
  fi

  while IFS= read -r socket; do
    if systemctl is-enabled --quiet "${socket}" 2>/dev/null; then
      fail "SSH socket activation ist enabled und kann Port-Binding beeinflussen: ${socket}"
    else
      ok "SSH socket activation nicht enabled: ${socket}"
    fi
  done < <(ssh_socket_names)

  effective="$(sshd -T)"

  if grep -q '^permitrootlogin no$' <<<"${effective}"; then
    ok "SSH Root-Login deaktiviert"
  else
    fail "SSH Root-Login ist nicht deaktiviert"
  fi

  if grep -q '^passwordauthentication no$' <<<"${effective}"; then
    ok "SSH PasswordAuthentication deaktiviert"
  else
    fail "SSH PasswordAuthentication ist nicht deaktiviert"
  fi

  if grep -q '^kbdinteractiveauthentication no$' <<<"${effective}"; then
    ok "SSH KbdInteractiveAuthentication deaktiviert"
  else
    fail "SSH KbdInteractiveAuthentication ist nicht deaktiviert"
  fi

  if grep -q '^authenticationmethods publickey$' <<<"${effective}"; then
    ok "SSH AuthenticationMethods publickey aktiv"
  else
    fail "SSH AuthenticationMethods publickey nicht aktiv"
  fi

  while IFS= read -r port; do
    if grep -q "^port ${port}$" <<<"${effective}"; then
      ok "SSH Port aktiv: ${port}"
    else
      fail "SSH Port nicht aktiv wie erwartet: ${port}"
    fi

    if port_is_listening "${port}"; then
      ok "SSH Port lauscht lokal: ${port}"
    else
      fail "SSH Port lauscht lokal nicht: ${port}"
    fi
  done < <(list_ssh_ports)

  printf '\nEffektive SSH-Kernwerte:\n'
  sshd -T | grep -E '^(port|permitrootlogin|passwordauthentication|kbdinteractiveauthentication|authenticationmethods|maxauthtries|allowtcpforwarding|allowagentforwarding)' || true
}

check_firewall() {
  local port

  log "Check: UFW Firewall"

  if ufw status | grep -q 'Status: active'; then
    ok "UFW ist aktiv"
  else
    fail "UFW ist nicht aktiv"
  fi

  while IFS= read -r port; do
    if ufw status | grep -q "${port}/tcp"; then
      ok "UFW erlaubt SSH-Port ${port}/tcp"
    else
      fail "UFW-Regel für SSH-Port ${port}/tcp fehlt"
    fi
  done < <(list_ssh_ports)

  if ufw status | grep -q '80/tcp'; then
    ok "UFW erlaubt 80/tcp"
  else
    fail "UFW-Regel für 80/tcp fehlt"
  fi

  if ufw status | grep -q '443/tcp'; then
    ok "UFW erlaubt 443/tcp"
  else
    fail "UFW-Regel für 443/tcp fehlt"
  fi

  printf '\nUFW Status:\n'
  ufw status verbose || true
}

check_fail2ban() {
  log "Check: Fail2ban"

  check_service_active fail2ban
  check_service_enabled fail2ban

  if fail2ban-client status sshd >/dev/null 2>&1; then
    ok "Fail2ban Jail aktiv: sshd"
    printf '\nFail2ban sshd Status:\n'
    fail2ban-client status sshd || true
  else
    fail "Fail2ban Jail nicht aktiv: sshd"
  fi
}

check_unattended_upgrades() {
  log "Check: unattended-upgrades"

  check_service_enabled unattended-upgrades

  if [[ -f /etc/apt/apt.conf.d/20auto-upgrades ]]; then
    ok "20auto-upgrades vorhanden"
  else
    fail "20auto-upgrades fehlt"
  fi

  if grep -q 'APT::Periodic::Unattended-Upgrade "1";' /etc/apt/apt.conf.d/20auto-upgrades 2>/dev/null; then
    ok "Unattended upgrades aktiviert"
  else
    fail "Unattended upgrades nicht aktiviert"
  fi

  if [[ "${ENABLE_AUTOMATIC_REBOOT}" == "true" ]]; then
    if grep -q 'Unattended-Upgrade::Automatic-Reboot "true";' /etc/apt/apt.conf.d/51unattended-reboot 2>/dev/null; then
      ok "Automatischer Reboot aktiviert"
    else
      fail "Automatischer Reboot nicht wie erwartet aktiviert"
    fi
  else
    if grep -q 'Unattended-Upgrade::Automatic-Reboot "false";' /etc/apt/apt.conf.d/51unattended-reboot 2>/dev/null; then
      ok "Automatischer Reboot deaktiviert"
    else
      fail "Automatischer Reboot nicht wie erwartet deaktiviert"
    fi
  fi
}

check_chrony() {
  log "Check: chrony"

  check_service_active chrony
  check_service_enabled chrony

  printf '\nTime status:\n'
  timedatectl || true
}

check_docker() {
  if [[ "${INSTALL_DOCKER}" != "true" ]]; then
    log "Check: Docker übersprungen"
    return
  fi

  log "Check: Docker"

  check_command_exists docker

  if docker compose version >/dev/null 2>&1; then
    ok "Docker Compose Plugin vorhanden"
  else
    fail "Docker Compose Plugin fehlt"
  fi

  check_service_active docker
  check_service_enabled docker

  if docker info >/dev/null 2>&1; then
    ok "Docker Daemon erreichbar"
  else
    fail "Docker Daemon nicht erreichbar"
  fi

  if [[ -f "${DOCKER_DAEMON_JSON}" ]]; then
    ok "Docker daemon.json vorhanden"
  else
    fail "Docker daemon.json fehlt"
  fi

  if docker info --format '{{.LoggingDriver}}' 2>/dev/null | grep -qx 'json-file'; then
    ok "Docker Logging Driver json-file aktiv"
  else
    fail "Docker Logging Driver nicht wie erwartet"
  fi

  printf '\nDocker Version:\n'
  docker --version || true
  docker compose version || true

  printf '\nDocker Info Kurzfassung:\n'
  docker info --format 'Server Version: {{.ServerVersion}}' || true
  docker info --format 'Logging Driver: {{.LoggingDriver}}' || true
  docker info --format 'Cgroup Driver: {{.CgroupDriver}}' || true
}

check_filesystem_layout() {
  log "Check: Dateisystemlayout"

  if [[ -d "${STACKS_DIR}" ]]; then
    ok "Stacks-Verzeichnis vorhanden: ${STACKS_DIR}"
  else
    fail "Stacks-Verzeichnis fehlt: ${STACKS_DIR}"
  fi

  if [[ -d /opt/scripts ]]; then
    ok "Scripts-Verzeichnis vorhanden: /opt/scripts"
  else
    fail "Scripts-Verzeichnis fehlt: /opt/scripts"
  fi

  if [[ -d /opt/backups ]]; then
    ok "Backups-Verzeichnis vorhanden: /opt/backups"
  else
    fail "Backups-Verzeichnis fehlt: /opt/backups"
  fi
}

check_sysctl() {
  log "Check: sysctl Hardening"

  if [[ -f "${SYSCTL_HARDENING_FILE}" ]]; then
    ok "Sysctl-Hardening-Datei vorhanden"
  else
    fail "Sysctl-Hardening-Datei fehlt"
  fi

  local value

  value="$(sysctl -n kernel.dmesg_restrict 2>/dev/null || true)"
  if [[ "${value}" == '1' ]]; then
    ok "kernel.dmesg_restrict = 1"
  else
    fail "kernel.dmesg_restrict ist nicht 1"
  fi

  value="$(sysctl -n kernel.kptr_restrict 2>/dev/null || true)"
  if [[ "${value}" == '2' ]]; then
    ok "kernel.kptr_restrict = 2"
  else
    fail "kernel.kptr_restrict ist nicht 2"
  fi

  value="$(sysctl -n fs.protected_hardlinks 2>/dev/null || true)"
  if [[ "${value}" == '1' ]]; then
    ok "fs.protected_hardlinks = 1"
  else
    fail "fs.protected_hardlinks ist nicht 1"
  fi

  value="$(sysctl -n fs.protected_symlinks 2>/dev/null || true)"
  if [[ "${value}" == '1' ]]; then
    ok "fs.protected_symlinks = 1"
  else
    fail "fs.protected_symlinks ist nicht 1"
  fi
}

check_open_ports() {
  local expected_pattern
  local unexpected
  local -a expected_ports

  log "Check: offene TCP Listening Ports"

  printf '\nListening TCP Ports:\n'
  ss -tlnp || true

  mapfile -t expected_ports < <(list_ssh_ports)
  expected_pattern="$(printf '%s\n' 80 443 "${expected_ports[@]}" | awk 'NF && !seen[$0]++' | paste -sd'|' -)"
  unexpected="$(ss -tlnH | awk '{print $4}' | sed -E 's/.*:([0-9]+)$/\1/' | sort -nu | grep -Ev "^(${expected_pattern})$" || true)"

  if [[ -z "${unexpected}" ]]; then
    ok "Keine unerwarteten TCP Listening Ports erkannt"
  else
    warn "Unerwartete TCP Listening Ports erkannt: ${unexpected//$'\n'/, }"
  fi
}

run_system_checks() {
  printf '\n'
  printf '===============================================================================\n'
  printf 'SYSTEM CHECKS\n'
  printf '===============================================================================\n'

  CHECK_FAILED=0
  CHECK_WARNINGS=0

  check_user_and_groups
  check_ssh_effective_config
  check_firewall
  check_fail2ban
  check_unattended_upgrades
  check_chrony
  check_docker
  check_filesystem_layout
  check_sysctl
  check_open_ports

  printf '\n'
  printf '===============================================================================\n'
  printf 'CHECK SUMMARY\n'
  printf '===============================================================================\n'

  if [[ "${CHECK_FAILED}" -eq 0 ]]; then
    ok "Alle kritischen Checks bestanden."
  else
    fail "${CHECK_FAILED} kritische Check(s) fehlgeschlagen."
  fi

  if [[ "${CHECK_WARNINGS}" -gt 0 ]]; then
    printf '\033[1;33m[WARN]\033[0m %s Warnung(en) vorhanden.\n' "${CHECK_WARNINGS}"
  fi

  printf '\nNächste manuelle Checks:\n'
  printf '  1. Zweite SSH-Session testen:\n'
  printf '     ssh -p %s %s@SERVER_IP\n' "${SSH_PORT}" "${ADMIN_USER}"
  printf '\n'
  if [[ "${SSH_PORT}" != '22' && "${KEEP_SSH_PORT_22}" == 'true' ]]; then
    printf '  2. Optional Fallback-Port 22 testen:\n'
    printf '     ssh -p 22 %s@SERVER_IP\n' "${ADMIN_USER}"
    printf '\n'
    printf '  3. Root-Login muss fehlschlagen:\n'
  else
    printf '  2. Root-Login muss fehlschlagen:\n'
  fi
  printf '     ssh -p %s root@SERVER_IP\n' "${SSH_PORT}"
  printf '\n'
  if [[ "${SSH_PORT}" != '22' && "${KEEP_SSH_PORT_22}" == 'true' ]]; then
    printf '  4. Nach neuem Login Docker ohne sudo testen:\n'
  else
    printf '  3. Nach neuem Login Docker ohne sudo testen:\n'
  fi
  printf '     docker ps\n'
  printf '\n'
  if [[ "${SSH_PORT}" != '22' && "${KEEP_SSH_PORT_22}" == 'true' ]]; then
    printf '  5. Nach Reboot final testen:\n'
  else
    printf '  4. Nach Reboot final testen:\n'
  fi
  printf '     sudo reboot\n'
  printf '     docker run --rm hello-world\n'
}

main() {
  parse_args "$@"
  prompt_missing_args
  validate_args

  require_root
  detect_debian

  apt_update_once
  update_system
  install_base_packages
  verify_ssh_installation
  capture_existing_ssh_port

  create_admin_user
  configure_sudo
  configure_ssh
  configure_firewall
  configure_fail2ban
  configure_unattended_upgrades
  configure_chrony

  install_docker_engine
  configure_docker_daemon

  prepare_filesystem_layout
  apply_sysctl_hardening

  run_system_checks
}

main "$@"
