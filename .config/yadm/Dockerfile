# Use a lightweight base image
FROM --platform=linux/amd64 ubuntu:24.04

# Set environment variables
ENV DEBIAN_FRONTEND=noninteractive

# Install required dependencies (curl, git, and others)
RUN apt-get update && apt-get install -y build-essential procps curl file git

# Copy setup script
COPY setup.sh /setup.sh

# Make setup script executable
RUN chmod +x /setup.sh

# Create dockerenv file to tell brew, this is a automated script
# Otherwise brew is complaining, that it can not be executed as root
RUN touch /.dockerenv

# Run the setup script (YADM handles the rest via bootstrap)
RUN /setup.sh

CMD ["/home/linuxbrew/.linuxbrew/bin/zsh"]
