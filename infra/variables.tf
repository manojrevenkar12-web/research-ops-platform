variable "environment" {
  description = "Short environment name, e.g. dev or prod."
  type        = string
  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "environment must be dev or prod."
  }
}

variable "location" {
  description = "Azure region."
  type        = string
  default     = "germanywestcentral"
}

variable "tenant_id" {
  description = "Entra ID tenant of the company."
  type        = string
}

variable "api_image" {
  description = "Container image of the API, pinned by digest (registry/name@sha256:...)."
  type        = string
  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.api_image))
    error_message = "api_image must be pinned by digest."
  }
}

variable "postgres_admin_group_object_id" {
  description = "Entra ID group whose members administer the database (no password login exists)."
  type        = string
}

variable "backup_retention_days" {
  description = "PostgreSQL point-in-time restore window."
  type        = number
  default     = 35
  validation {
    condition     = var.backup_retention_days >= 7 && var.backup_retention_days <= 35
    error_message = "backup_retention_days must be between 7 and 35."
  }
}

variable "alert_email" {
  description = "Where alerts go (the owning team's shared mailbox)."
  type        = string
}

# Generated from config/ by `pnpm generate` (infra/*.auto.tfvars.json).
variable "app_roles" {
  description = "Entra ID app roles of the API, from config/access.yaml."
  type = list(object({
    value        = string
    display_name = string
    description  = string
    member_types = list(string)
  }))
}

variable "alerts" {
  description = "Alert rules, from config/alerts.yaml."
  type = map(object({
    metric         = string
    filter         = map(string)
    condition      = string
    threshold      = number
    window_minutes = number
    severity       = number
    apps           = list(string)
  }))
}
