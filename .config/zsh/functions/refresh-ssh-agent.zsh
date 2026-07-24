# Refresh SSH agent socket after attaching to a long-running process.
refresh-ssh-agent() {
  local socket

  # SSH agent forwarding sockets are created by sshd under /tmp/ssh-*/agent.*.
  for socket in /tmp/ssh-*/agent.*(NOm); do
    if [[ -S "$socket" ]]; then
      export SSH_AUTH_SOCK="$socket"
      echo "SSH_AUTH_SOCK set to: $SSH_AUTH_SOCK"
      return 0
    fi
  done

  echo "No SSH agent socket found under /tmp/ssh-*" >&2
  return 1
}
