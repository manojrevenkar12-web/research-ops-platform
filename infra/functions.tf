# Scheduled jobs (apps/jobs) as Azure Functions timer triggers on the Flex Consumption plan.
resource "azurerm_storage_account" "functions" {
  name                            = replace("st${local.name}fn", "-", "")
  location                        = azurerm_resource_group.main.location
  resource_group_name             = azurerm_resource_group.main.name
  account_tier                    = "Standard"
  account_replication_type        = "ZRS"
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false
  shared_access_key_enabled       = false
  tags                            = local.tags
}

resource "azurerm_storage_container" "deployments" {
  name                  = "deployments"
  storage_account_id    = azurerm_storage_account.functions.id
  container_access_type = "private"
}

resource "azurerm_role_assignment" "jobs_storage" {
  scope                = azurerm_storage_account.functions.id
  role_definition_name = "Storage Blob Data Owner"
  principal_id         = azurerm_user_assigned_identity.jobs.principal_id
}

resource "azurerm_service_plan" "functions" {
  name                = "asp-${local.name}-jobs"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  os_type             = "Linux"
  sku_name            = "FC1"
  tags                = local.tags
}

resource "azurerm_function_app_flex_consumption" "jobs" {
  name                = "func-${local.name}-jobs"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  service_plan_id     = azurerm_service_plan.functions.id

  storage_container_type            = "blobContainer"
  storage_container_endpoint        = "${azurerm_storage_account.functions.primary_blob_endpoint}${azurerm_storage_container.deployments.name}"
  storage_authentication_type       = "UserAssignedIdentity"
  storage_user_assigned_identity_id = azurerm_user_assigned_identity.jobs.id
  runtime_name                      = "node"
  runtime_version                   = "22"
  maximum_instance_count            = 40
  instance_memory_in_mb             = 2048
  virtual_network_subnet_id         = azurerm_subnet.functions.id

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.jobs.id]
  }

  app_settings = {
    ROP_DB_AUTH                           = "entra"
    AZURE_CLIENT_ID                       = azurerm_user_assigned_identity.jobs.client_id
    ROP_APP_DATABASE_URL                  = "postgres://${azurerm_user_assigned_identity.jobs.name}@${azurerm_postgresql_flexible_server.main.fqdn}:5432/rop?sslmode=require"
    APPLICATIONINSIGHTS_CONNECTION_STRING = azurerm_application_insights.main.connection_string
  }

  site_config {}
  tags = local.tags
}
