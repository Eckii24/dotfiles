# Use a lightweight base image
FROM --platform=linux/amd64 ubuntu:24.04

# Set environment variables
ENV DEBIAN_FRONTEND=noninteractive

# Install required dependencies for yadm
RUN apt-get update && apt-get install -y curl git

# Setup ssh server (must be used with a mounted key)
# use '-v ~/.ssh/id_rsa.pub:/root/.ssh/authorized_keys/id_rsa.pub:ro'
RUN apt-get update && apt-get install -y openssh-server

RUN mkdir /var/run/sshd
RUN echo "PasswordAuthentication no" >> /etc/ssh/sshd_config

# Create dockerenv file to tell brew, this is a automated script
# Otherwise brew is complaining, that it can not be executed as root
RUN touch /.dockerenv

# Run the setup script (YADM handles the rest via bootstrap)
RUN /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Eckii24/dotfiles/refs/heads/master/.config/setup-scripts/setup.sh)"

EXPOSE 22
CMD ["/usr/sbin/sshd", "-D"]
