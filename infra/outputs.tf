output "api_url" {
  value = "https://${azurerm_container_app.api.ingress[0].fqdn}"
}

output "api_client_id" {
  value = azuread_application.api.client_id
}

output "postgres_fqdn" {
  value = azurerm_postgresql_flexible_server.main.fqdn
}

output "database_roles_to_create" {
  description = "Run once as a database admin after the first apply (see docs/runbooks/platform.md)."
  value = [
    "SELECT * FROM pgaadauth_create_principal('${azurerm_user_assigned_identity.api.name}', false, false);",
    "SELECT * FROM pgaadauth_create_principal('${azurerm_user_assigned_identity.jobs.name}', false, false);",
    "GRANT rop_app TO \"${azurerm_user_assigned_identity.api.name}\", \"${azurerm_user_assigned_identity.jobs.name}\";",
  ]
}
