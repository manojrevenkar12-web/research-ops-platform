terraform {
  required_version = ">= 1.8.0"
  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "~> 4.40" }
    azuread = { source = "hashicorp/azuread", version = "~> 3.4" }
    random  = { source = "hashicorp/random", version = "~> 3.7" }
  }
  # State lives in an Azure storage account with blob versioning; configured per environment at init:
  #   tofu init -backend-config=env/<name>.backend.hcl
  backend "azurerm" {}
}

provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy = false
    }
  }
  storage_use_azuread = true
}

provider "azuread" {}
