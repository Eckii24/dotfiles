FROM eckii24/dev-base:latest

RUN /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Eckii24/dotfiles/refs/heads/master/.config/setup-scripts/setup-php.sh)"

EXPOSE 22
CMD ["/usr/sbin/sshd", "-D"]
