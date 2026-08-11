# Work image. Build base image first.
FROM pi-agent-base:0.12.0

ARG DAPR_VERSION=1.18.0
ARG K6_VERSION=2.2.0

RUN apk --no-check-certificate add --no-cache dotnet9-sdk python3 py3-pip \
 && pip config set global.trusted-host pypi.org \
 && pip config set global.trusted-host files.pythonhosted.org \
 && pip install --break-system-packages --no-cache-dir azure-cli \
 && dotnet tool install --global csharpier \
 && dotnet tool install --global dotnet-outdated-tool \
 && dotnet tool install --global dotnet-ef \
 && curl -kfsSL --retry 3 --retry-all-errors -o /tmp/dapr.tar.gz "https://github.com/dapr/cli/releases/download/v${DAPR_VERSION}/dapr_linux_amd64.tar.gz" \
 && tar -xzf /tmp/dapr.tar.gz -C /usr/local/bin dapr \
 && chmod 0755 /usr/local/bin/dapr \
 && rm -f /tmp/dapr.tar.gz \
 && curl -kfsSL --retry 3 --retry-all-errors -o /tmp/k6.tar.gz "https://github.com/grafana/k6/releases/download/v${K6_VERSION}/k6-v${K6_VERSION}-linux-amd64.tar.gz" \
 && tar -xzf /tmp/k6.tar.gz -C /tmp \
 && install -m 0755 "/tmp/k6-v${K6_VERSION}-linux-amd64/k6" /usr/local/bin/k6 \
 && rm -rf /tmp/k6.tar.gz "/tmp/k6-v${K6_VERSION}-linux-amd64"

ENV PATH="/root/.dotnet/tools:${PATH}"
