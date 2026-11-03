# Alert rules from config/alerts.yaml (via infra/alerts.auto.tfvars.json). The KQL reads the
# OpenTelemetry metrics the API and jobs export to Application Insights.
resource "azurerm_monitor_action_group" "owners" {
  name                = "ag-${local.name}-owners"
  resource_group_name = azurerm_resource_group.main.name
  short_name          = "rop-owners"
  email_receiver {
    name          = "owners"
    email_address = var.alert_email
  }
  tags = local.tags
}

locals {
  filter_kql = {
    for name, a in var.alerts : name => join("", [for k, v in a.filter : " and tostring(customDimensions['${k}']) == '${v}'"])
  }
  alert_kql = {
    for name, a in var.alerts : name => (
      a.condition == "rate_over_total" ?
      "customMetrics | where name == 'http_server_requests_total' | summarize bad = sumif(value, true${local.filter_kql[name]}), total = sum(value) | extend ratio = iff(total == 0, 0.0, bad / total) | project ratio" :
      a.condition == "p95" ?
      "customMetrics | where name == '${a.metric}' | summarize value = percentile(value, 95)" :
      a.condition == "count" ?
      "customMetrics | where name == '${a.metric}'${local.filter_kql[name]} | summarize value = sum(value)" :
      "customMetrics | where name == '${a.metric}' | summarize arg_max(timestamp, value) | project value"
    )
  }
}

resource "azurerm_monitor_scheduled_query_rules_alert_v2" "rules" {
  for_each             = var.alerts
  name                 = "alert-${local.name}-${replace(each.key, "_", "-")}"
  location             = azurerm_resource_group.main.location
  resource_group_name  = azurerm_resource_group.main.name
  scopes               = [azurerm_application_insights.main.id]
  severity             = each.value.severity
  evaluation_frequency = "PT5M"
  window_duration      = "PT${each.value.window_minutes}M"
  description          = "From config/alerts.yaml; runbook section 'Alerts and what to do' of the apps: ${join(", ", each.value.apps)}"

  criteria {
    query                   = local.alert_kql[each.key]
    time_aggregation_method = "Maximum"
    metric_measure_column   = each.key == "api_5xx_rate" ? "ratio" : "value"
    operator                = "GreaterThan"
    threshold               = each.value.threshold
  }

  action {
    action_groups = [azurerm_monitor_action_group.owners.id]
  }
  tags = local.tags
}
