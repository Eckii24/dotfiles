export NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/zscaler-root-cert.crt
# export SSL_CERT_FILE=/usr/local/share/ca-certificates/zscaler-root-cert.crt

# Regular development with dapr secrets
: "${P0_DAPR_SERVICE_BUS_CONNECTION_STRING:=op://Employee/P0_DAPR_SERVICE_BUS_CONNECTION_STRING/password}"
export P0_DAPR_SERVICE_BUS_CONNECTION_STRING
: "${P0_DAPR_STORAGE_ACCOUNT:=op://Employee/P0_DAPR_STORAGE_ACCOUNT/password}"
export P0_DAPR_STORAGE_ACCOUNT
: "${P0_DAPR_STORAGE_ACCESS_KEY:=op://Employee/P0_DAPR_STORAGE_ACCESS_KEY/password}"
export P0_DAPR_STORAGE_ACCESS_KEY
: "${P0_DAPR_STORAGE_ENDPOINT:=op://Employee/P0_DAPR_STORAGE_ENDPOINT/password}"
export P0_DAPR_STORAGE_ENDPOINT
: "${P0_DAPR_REDIS_HOST:=op://Employee/P0_DAPR_REDIS_HOST/password}"
export P0_DAPR_REDIS_HOST
: "${P0_DAPR_ZEEBE_GATEWAY_ADDR:=op://Employee/P0_DAPR_ZEEBE_GATEWAY_ADDR/password}"
export P0_DAPR_ZEEBE_GATEWAY_ADDR

# Dapr configuration
export DAPR_HOST_IP="127.0.0.1"

# Azure Open AI
: "${AZURE_API_KEY:=op://Employee/AZURE_API_KEY/password}"
export AZURE_API_KEY
: "${AZURE_API_BASE:=op://Employee/AZURE_API_BASE/password}"
export AZURE_API_BASE
: "${AZURE_RESOURCE_NAME:=op://Employee/AZURE_RESOURCE_NAME/password}"
export AZURE_RESOURCE_NAME
export AZURE_API_VERSION="2025-04-01-preview"

# Database connection strings
: "${DB_UI_DOCKER:=op://Employee/DB_UI_DOCKER/password}"
export DB_UI_DOCKER
: "${DB_UI_DEV:=op://Employee/DB_UI_DEV/password}"
export DB_UI_DEV
: "${DB_UI_RXP:=op://Employee/DB_UI_RXP/password}"
export DB_UI_RXP
: "${DB_UI_VIP_DEV:=op://Employee/DB_UI_VIP_DEV/password}"
export DB_UI_VIP_DEV
: "${DB_UI_TEST:=op://Employee/DB_UI_TEST/password}"
export DB_UI_TEST
: "${DB_UI_STAGE:=op://Employee/DB_UI_STAGE/password}"
export DB_UI_STAGE
: "${DB_UI_PROD:=op://Employee/DB_UI_PROD/password}"
export DB_UI_PROD
: "${DB_UI_REDIS:=op://Employee/DB_UI_REDIS/password}"
export DB_UI_REDIS

# Azure DevOps
: "${AZURE_DEVOPS_ORG:=op://Employee/AZURE_DEVOPS_ORG/password}"
export AZURE_DEVOPS_ORG
: "${AZURE_DEVOPS_ORG_URL:=op://Employee/AZURE_DEVOPS_ORG_URL/password}"
export AZURE_DEVOPS_ORG_URL
: "${AZURE_DEVOPS_PAT:=op://Employee/AZURE_DEVOPS_PAT/password}"
export AZURE_DEVOPS_PAT
: "${AZURE_DEVOPS_DEFAULT_PROJECT:=op://Employee/AZURE_DEVOPS_DEFAULT_PROJECT/password}"
export AZURE_DEVOPS_DEFAULT_PROJECT
