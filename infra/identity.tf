# The API's app registration in Entra ID. Its app roles come from config/access.yaml, so the roles people
# are assigned in Entra are exactly the roles the database policies know.
resource "random_uuid" "app_role" {
  for_each = { for r in var.app_roles : r.value => r }
}

resource "azuread_application" "api" {
  display_name     = "Research Ops Platform (${var.environment})"
  identifier_uris  = ["api://research-ops-platform${var.environment == "prod" ? "" : "-${var.environment}"}"]
  sign_in_audience = "AzureADMyOrg"

  api {
    requested_access_token_version = 2
  }

  dynamic "app_role" {
    for_each = { for r in var.app_roles : r.value => r }
    content {
      id                   = random_uuid.app_role[app_role.key].result
      value                = app_role.value.value
      display_name         = app_role.value.display_name
      description          = app_role.value.description
      allowed_member_types = app_role.value.member_types
      enabled              = true
    }
  }

  # idtyp lets the API tell application tokens from people's tokens.
  optional_claims {
    access_token {
      name = "idtyp"
    }
  }
}

resource "azuread_service_principal" "api" {
  client_id                    = azuread_application.api.client_id
  app_role_assignment_required = true
}
