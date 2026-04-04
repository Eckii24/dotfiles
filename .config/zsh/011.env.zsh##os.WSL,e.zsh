export NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/zscaler-root-cert.crt
# export SSL_CERT_FILE=/usr/local/share/ca-certificates/zscaler-root-cert.crt

# Regular development with dapr secrets
export P0_DAPR_SERVICE_BUS_CONNECTION_STRING="op://Employee/P0_DAPR_SERVICE_BUS_CONNECTION_STRING/password"
export P0_DAPR_STORAGE_ACCOUNT="op://Employee/P0_DAPR_STORAGE_ACCOUNT/password"
export P0_DAPR_STORAGE_ACCESS_KEY="op://Employee/P0_DAPR_STORAGE_ACCESS_KEY/password"
export P0_DAPR_STORAGE_ENDPOINT="op://Employee/P0_DAPR_STORAGE_ENDPOINT/password"
export P0_DAPR_REDIS_HOST="op://Employee/P0_DAPR_REDIS_HOST/password"
export P0_DAPR_ZEEBE_GATEWAY_ADDR="op://Employee/P0_DAPR_ZEEBE_GATEWAY_ADDR/password"

# Dapr configuration
export DAPR_HOST_IP="127.0.0.1"

# Azure Open AI
export AZURE_API_KEY="op://Employee/AZURE_API_KEY/password"
export AZURE_API_BASE="op://Employee/AZURE_API_BASE/password"
export AZURE_RESOURCE_NAME="op://Employee/AZURE_RESOURCE_NAME/password"
export AZURE_API_VERSION="2025-04-01-preview"

# Copilot
export COPILOT_BASE="zeiss.ghe.com"
export COPILOT_API_BASE="https://copilot-api.zeiss.ghe.com"

# Database connection strings
export DB_UI_DOCKER="op://Employee/DB_UI_DOCKER/password"
export DB_UI_DEV="op://Employee/DB_UI_DEV/password"
export DB_UI_RXP="op://Employee/DB_UI_RXP/password"
export DB_UI_VIP_DEV="op://Employee/DB_UI_VIP_DEV/password"
export DB_UI_TEST="op://Employee/DB_UI_TEST/password"
export DB_UI_STAGE="op://Employee/DB_UI_STAGE/password"
export DB_UI_PROD="op://Employee/DB_UI_PROD/password"
export DB_UI_REDIS="op://Employee/DB_UI_REDIS/password"

# Azure DevOps
export AZURE_DEVOPS_ORG="op://Employee/AZURE_DEVOPS_ORG/password"
export AZURE_DEVOPS_ORG_URL="op://Employee/AZURE_DEVOPS_ORG_URL/password"
export AZURE_DEVOPS_PAT="op://Employee/AZURE_DEVOPS_PAT/password"
export AZURE_DEVOPS_DEFAULT_PROJECT="op://Employee/AZURE_DEVOPS_DEFAULT_PROJECT/password"
