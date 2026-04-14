# Descripcion
Este template es usado para levantar EC2 Agents basado en AMIs Arm

# Beneficios
1.	Se desacopla la imagen, del como sera utilizada
2.	Simplifica el llamado de la instancia en codigo ya que en el codigo solo se debe conocer el nombre del template
3.	Disminuye la cantidad de codigo y evita que se tengan que desarrollar validaciones y funcionalidades

# Importante
1. El script de user data debe siempre tomar el token para la autenticación de un secreto
2. El Script de User data debe usar try cath de manera que si la inicialización del agente falla la instancia se termine
