#!/bin/bash
# Script de inicialización de recursos AWS en LocalStack
# Se ejecuta automáticamente al arrancar el contenedor

set -e

echo "==> Creando tabla DynamoDB: agents-monitor-lnx-arm"
awslocal dynamodb create-table \
  --table-name agents-monitor-lnx-arm \
  --attribute-definitions AttributeName=conditions,AttributeType=S \
  --key-schema AttributeName=conditions,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1

echo "==> Insertando fila inicial en DynamoDB"
awslocal dynamodb put-item \
  --table-name agents-monitor-lnx-arm \
  --item '{"conditions": {"S": "LnxArmJobs"}, "jobsRequested": {"L": []}}' \
  --region us-east-1

echo "==> Creando secreto en Secrets Manager: devops-azure-pat-test"
awslocal secretsmanager create-secret \
  --name devops-azure-pat-test \
  --secret-string '{"token":"fake-pat-for-local-testing"}' \
  --region us-east-1

echo "==> Recursos LocalStack inicializados correctamente"
