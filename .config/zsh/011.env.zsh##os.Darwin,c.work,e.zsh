PATH="/opt/homebrew/opt/trash-cli/bin:$PATH"
export PATH

export NODE_EXTRA_CA_CERTS=/Users/matthias.eck/zscaler-root-cert.crt

# Regular development with dapr secrets
export P0_DAPR_SERVICE_BUS_CONNECTION_STRING="op://Employee/P0_DAPR_SERVICE_BUS_CONNECTION_STRING/password"
export P0_DAPR_STORAGE_ACCOUNT="op://Employee/P0_DAPR_STORAGE/ACCOUNT"
export P0_DAPR_STORAGE_ACCESS_KEY="op://Employee/P0_DAPR_STORAGE/password"
export P0_DAPR_STORAGE_ENDPOINT=
export P0_DAPR_REDIS_HOST="localhost:6379"
export P0_DAPR_ZEEBE_GATEWAY_ADDR="localhost:26500"

# Dapr configuration
export DAPR_HOST_IP="127.0.0.1"

# Azure Open AI
export AZURE_API_KEY="op://Employee/AzureOpenAI/password"
export AZURE_API_BASE="op://Employee/AzureOpenAI/BASE"
export AZURE_RESOURCE_NAME="op://Employee/AzureOpenAI/RESOURCE_NAME"
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
export AZURE_DEVOPS_ORG="op://Employee/AzureDevOps/ORG"
export AZURE_DEVOPS_ORG_URL="op://Employee/AzureDevOps/ORG_URL"
export AZURE_DEVOPS_PAT="op://Employee/AzureDevOps/password"
export AZURE_DEVOPS_DEFAULT_PROJECT="op://Employee/AzureDevOps/DEFAULT_PROJECT"
