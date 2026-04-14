# azure-devops-agent-lnx-arm

# Descripción
Ecalador de Agentes EC2 en AWS, para colas de Jobs de Azure Devops

# Introducción
1. Lambda Generadora de Agentes:
- Monitorea el Pool de Agentes Cada minuto
- Si encuentra un Agente enconlado crear una Instancia EC2 la cual se conectara como agente al Pool
- Para Crear las Instancias requiere una Plantilla de Lanzamiento

2. Lambda Finalizadora de Agentes
- Monitorea los agentes asociados a un Pool en un periodo definido (Actualmente configurado en 15 min)
- Si detecta que un agente tiene mas 30 min sin ejecutar algun Job, finaliza la instancia EC2 del agente

# Beneficios
1. Permite manetener una cantidad de Agentes de 0 hasta una cantidad indicada
2. Elimina las instancias cuando estas no estan en uso
3. Los agentes se inician siempre en el mismo estado
