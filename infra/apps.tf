data "azurerm_client_config" "current" {}

resource "azurerm_container_app_environment" "main" {
  name                           = "cae-${local.name}"
  location                       = azurerm_resource_group.main.location
  resource_group_name            = azurerm_resource_group.main.name
  log_analytics_workspace_id     = azurerm_log_analytics_workspace.main.id
  infrastructure_subnet_id       = azurerm_subnet.apps.id
  internal_load_balancer_enabled = false
  tags                           = local.tags
}

# The API: stateless, so it scales horizontally; the identity of each request lives in PostgreSQL settings
# for one transaction, never in the process.
resource "azurerm_container_app" "api" {
  name                         = "ca-${local.name}-api"
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"
  tags                         = local.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.api.id]
  }

  template {
    min_replicas = var.environment == "prod" ? 2 : 1
    max_replicas = 6

    container {
      name   = "api"
      image  = var.api_image
      cpu    = 0.5
      memory = "1Gi"

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "AUTH_MODE"
        value = "entra"
      }
      env {
        name  = "ENTRA_TENANT_ID"
        value = var.tenant_id
      }
      env {
        name  = "ENTRA_AUDIENCE"
        value = one(azuread_application.api.identifier_uris)
      }
      env {
        name  = "ROP_DB_AUTH"
        value = "entra"
      }
      env {
        name  = "AZURE_CLIENT_ID"
        value = azurerm_user_assigned_identity.api.client_id
      }
      env {
        name  = "ROP_APP_DATABASE_URL"
        value = "postgres://${azurerm_user_assigned_identity.api.name}@${azurerm_postgresql_flexible_server.main.fqdn}:5432/rop?sslmode=require"
      }
      env {
        name  = "APPLICATIONINSIGHTS_CONNECTION_STRING"
        value = azurerm_application_insights.main.connection_string
      }

      liveness_probe {
        transport = "HTTP"
        path      = "/health/live"
        port      = 8080
      }
      readiness_probe {
        transport = "HTTP"
        path      = "/health/ready"
        port      = 8080
      }
    }

    http_scale_rule {
      name                = "http"
      concurrent_requests = "50"
    }
  }

  ingress {
    external_enabled = true
    target_port      = 8080
    transport        = "http"
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }
}

# Third-party credentials, if an app ever needs one, go here; today none does (identities sign in instead).
resource "azurerm_key_vault" "main" {
  name                          = "kv-${local.name}"
  location                      = azurerm_resource_group.main.location
  resource_group_name           = azurerm_resource_group.main.name
  tenant_id                     = var.tenant_id
  sku_name                      = "standard"
  rbac_authorization_enabled    = true
  purge_protection_enabled      = true
  soft_delete_retention_days    = 90
  public_network_access_enabled = false
  tags                          = local.tags
}

resource "azurerm_role_assignment" "api_reads_secrets" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.api.principal_id
}

resource "azurerm_role_assignment" "jobs_reads_secrets" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.jobs.principal_id
}

# The web console: static files, signed-in users only (Entra ID), calling the API with their own token.
resource "azurerm_static_web_app" "web" {
  name                = "stapp-${local.name}"
  location            = "westeurope"
  resource_group_name = azurerm_resource_group.main.name
  sku_tier            = "Standard"
  sku_size            = "Standard"
  tags                = local.tags
}
