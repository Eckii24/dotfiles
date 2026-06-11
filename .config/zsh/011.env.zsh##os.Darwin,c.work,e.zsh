PATH="/opt/homebrew/opt/trash-cli/bin:$PATH"
export PATH

export NODE_EXTRA_CA_CERTS=/Users/matthias.eck/zscaler-root-cert.crt

# Regular development with dapr secrets
: "${P0_DAPR_SERVICE_BUS_CONNECTION_STRING:=op://Employee/P0_DAPR_SERVICE_BUS_CONNECTION_STRING/password}"
export P0_DAPR_SERVICE_BUS_CONNECTION_STRING
: "${P0_DAPR_STORAGE_ACCOUNT:=op://Employee/P0_DAPR_STORAGE/ACCOUNT}"
export P0_DAPR_STORAGE_ACCOUNT
: "${P0_DAPR_STORAGE_ACCESS_KEY:=op://Employee/P0_DAPR_STORAGE/password}"
export P0_DAPR_STORAGE_ACCESS_KEY
export P0_DAPR_STORAGE_ENDPOINT=
: "${P0_DAPR_REDIS_HOST:=localhost:6379}"
export P0_DAPR_REDIS_HOST
: "${P0_DAPR_ZEEBE_GATEWAY_ADDR:=localhost:26500}"
export P0_DAPR_ZEEBE_GATEWAY_ADDR

# Dapr configuration
export DAPR_HOST_IP="127.0.0.1"

# Azure Open AI
: "${AZURE_API_KEY:=op://Employee/AzureOpenAI/password}"
export AZURE_API_KEY
: "${AZURE_API_BASE:=op://Employee/AzureOpenAI/BASE}"
export AZURE_API_BASE
: "${AZURE_RESOURCE_NAME:=op://Employee/AzureOpenAI/RESOURCE_NAME}"
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

: "${VIP_CONNECTIONSTRING_CENTRAL:=op://Employee/vip-db-connectionString/local}"
export VIP_CONNECTIONSTRING_CENTRAL
: "${OMR_CONNECTIONSTRING_CENTRAL:=op://Employee/omr-connectionString-central/dev}"
export OMR_CONNECTIONSTRING_CENTRAL
# export COSMOS_CONNECTIONSTRING="op://Employee/cosmosdb-connectionString/test"

# Azure DevOps
: "${AZURE_DEVOPS_ORG:=op://Employee/AzureDevOps/ORG}"
export AZURE_DEVOPS_ORG
: "${AZURE_DEVOPS_ORG_URL:=op://Employee/AzureDevOps/ORG_URL}"
export AZURE_DEVOPS_ORG_URL
: "${AZURE_DEVOPS_PAT:=op://Employee/AzureDevOps/password}"
export AZURE_DEVOPS_PAT
: "${AZURE_DEVOPS_DEFAULT_PROJECT:=op://Employee/AzureDevOps/DEFAULT_PROJECT}"
export AZURE_DEVOPS_DEFAULT_PROJECT
: "${DevOpsConfiguration__DevOpsOrganizaton:=op://Employee/AzureDevOps/ORG}"
export DevOpsConfiguration__DevOpsOrganizaton
: "${DevOpsConfiguration__DevOpsProject:=op://Employee/AzureDevOps/DEFAULT_PROJECT}"
export DevOpsConfiguration__DevOpsProject
: "${DevOpsConfiguration__PersonalAccessToken:=op://Employee/AzureDevOps/password}"
export DevOpsConfiguration__PersonalAccessToken

# Nuget Config
: "${NUGET_P0_PASSWORD:=op://Employee/Nuget/password}"
export NUGET_P0_PASSWORD
