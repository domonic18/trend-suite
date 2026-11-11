# 01 部署 Runbook（占位）

## 1. 拓扑与前置
（服务器要求、域名、TLS；密钥只走 .env 注入，不入库）

## 2. 发布流程
（唯一入口：apps/cloud/cicd/deploy.sh；禁止手工 compose up 发布）

## 3. 迁移与备份
（迁移独立执行；备份 cron 约定）

## 4. 回滚
