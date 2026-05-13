# Manual de Usuario — CMMS Industrial SEAM

**Versión:** Mayo 2026  
**Aplicación:** Sistema de Gestión de Mantenimiento (CMMS)  
**Plataforma:** Web (escritorio y tablet)

---

## Índice

1. [Introducción](#1-introducción)
2. [Roles y permisos](#2-roles-y-permisos)
3. [Inicio de sesión](#3-inicio-de-sesión)
4. [Panel principal (Dashboard)](#4-panel-principal-dashboard)
5. [Órdenes de Trabajo (OTs)](#5-órdenes-de-trabajo-ots)
   - 5.1 [Ver listado de OTs](#51-ver-listado-de-ots)
   - 5.2 [Crear una OT manual](#52-crear-una-ot-manual)
   - 5.3 [Detalle de una OT](#53-detalle-de-una-ot)
   - 5.4 [Planillas (formularios de trabajo)](#54-planillas-formularios-de-trabajo)
   - 5.5 [Materiales](#55-materiales)
   - 5.6 [Firmas digitales](#56-firmas-digitales)
   - 5.7 [Historial y auditoría](#57-historial-y-auditoría)
   - 5.8 [Descarga de PDF](#58-descarga-de-pdf)
   - 5.9 [Uso sin conexión (offline)](#59-uso-sin-conexión-offline)
6. [Programa Semanal](#6-programa-semanal)
   - 6.1 [Vista del programa](#61-vista-del-programa)
   - 6.2 [Vencimientos SA (semi-anual/anual)](#62-vencimientos-sa-semi-anualanual)
   - 6.3 [Crear OT desde un aviso](#63-crear-ot-desde-un-aviso)
   - 6.4 [Agregar aviso al programa semanal](#64-agregar-aviso-al-programa-semanal)
   - 6.5 [Aprobación y publicación](#65-aprobación-y-publicación)
7. [Activos (Equipos)](#7-activos-equipos)
8. [Materiales — Reportes](#8-materiales--reportes)
9. [Portal del Cliente (Arauco)](#9-portal-del-cliente-arauco)
10. [Notificaciones](#10-notificaciones)
11. [Funciones de Inteligencia Artificial](#11-funciones-de-inteligencia-artificial)
12. [Administración — Gestión de Usuarios](#12-administración--gestión-de-usuarios)
13. [Configuración del Sistema (Superadmin)](#13-configuración-del-sistema-superadmin)
14. [Importación de datos (Excel / Avisos)](#14-importación-de-datos-excel--avisos)
15. [Perfil de usuario](#15-perfil-de-usuario)
16. [Preguntas frecuentes y solución de problemas](#16-preguntas-frecuentes-y-solución-de-problemas)

---

## 1. Introducción

El **CMMS Industrial SEAM** es un sistema de gestión de mantenimiento que permite planificar, ejecutar y registrar órdenes de trabajo de mantenimiento preventivo y correctivo en plantas industriales. Integra control de activos, consumo de materiales, planillas digitales con firma, calendario de vencimientos y un portal de visibilidad para el cliente (Arauco).

### Módulos principales

| Módulo | Descripción |
|--------|-------------|
| Órdenes de Trabajo | Crear, asignar, ejecutar y cerrar OTs |
| Programa Semanal | Planificar y publicar el programa de mantenimiento |
| Vencimientos | Control de avisos SA/anual vencidos o próximos |
| Activos | Catálogo de equipos con QR |
| Materiales | Registro y reporte de materiales consumidos |
| Portal Cliente | Vista publicada para el cliente Arauco |
| Administración | Usuarios, configuración y carga de datos |

---

## 2. Roles y permisos

El sistema tiene cinco roles. Cada rol tiene acceso a un conjunto específico de funciones.

### Tabla de permisos por rol

| Función | Técnico | Supervisor | Admin | Superadmin | Cliente |
|---------|:-------:|:----------:|:-----:|:----------:|:-------:|
| Ver OTs propias/asignadas | ✅ | ✅ | ✅ | ✅ | ✅ |
| Ver todas las OTs del centro | — | ✅ | ✅ | ✅ | — |
| Crear OT manual | — | ✅ | ✅ | ✅ | — |
| Crear OT desde aviso | — | ✅ | ✅ | ✅ | — |
| Reasignar técnico | — | ✅ | ✅ | ✅ | — |
| Completar planilla | ✅ | ✅ | ✅ | ✅ | — |
| Firmar planilla (SEAM) | ✅ | ✅ | ✅ | ✅ | — |
| Firmar planilla (Planta) | — | ✅ | ✅ | ✅ | ✅* |
| Registrar materiales | ✅ | ✅ | ✅ | ✅ | — |
| Descargar PDF | — | — | ✅ | ✅ | ✅* |
| Ver vencimientos SA | — | ✅ | ✅ | ✅ | — |
| Publicar programa semanal | — | ✅ | ✅ | ✅ | — |
| Ver programa publicado | — | ✅ | ✅ | ✅ | ✅ |
| Gestionar activos | — | — | ✅ | ✅ | — |
| Ver reporte de materiales | — | ✅ | ✅ | ✅ | — |
| Gestionar usuarios | — | — | ✅ | ✅ | — |
| Configuración del sistema | — | — | — | ✅ | — |
| Usar IA (redacción asistida) | — | — | ✅ | ✅ | — |
| Registrar empalmes históricos | — | — | — | ✅ | — |

*El cliente puede firmar y descargar PDF solo en OTs completadas y firmadas por SEAM.

### Descripción de cada rol

**Técnico SEAM**  
Opera en campo. Accede a sus OTs asignadas, completa planillas, registra materiales y firma como ejecutor. Puede ser asignado a más de un centro.

**Supervisor SEAM**  
Gestiona el equipo técnico, planifica el programa semanal, controla vencimientos y puede crear OTs. Aprueba y publica el programa de la semana.

**Admin (SEAM / Planta)**  
Administración del centro: gestiona usuarios, configura el sistema, importa datos y tiene acceso completo a reportes y configuración del centro.

**Superadmin**  
Acceso irrestricto a todos los centros y toda la configuración. Puede registrar empalmes históricos y administrar la configuración global del sistema.

**Cliente Arauco**  
Vista de solo lectura del programa publicado y OTs activas. Puede firmar la planilla como representante de planta y descargar PDF de OTs cerradas.

---

## 3. Inicio de sesión

1. Accedé a la URL de la aplicación en tu navegador.
2. Ingresá tu **correo electrónico** y **contraseña**.
3. Hacé clic en **Iniciar sesión**.

> Si no tenés usuario, contactá al administrador de tu planta. No es posible auto-registrarse.

**¿Olvidaste tu contraseña?**  
Hacé clic en "¿Olvidaste tu contraseña?" y seguí las instrucciones enviadas por correo.

---

## 4. Panel principal (Dashboard)

Al ingresar, el sistema muestra el panel principal con un resumen de la actividad del día.

### Secciones del dashboard

**Estadísticas rápidas**
- Cantidad de OTs del día (pendientes, en curso, completadas)
- OTs que requieren acción inmediata
- Resumen de actividad reciente

**Gráficos KPI**
- Distribución de OTs por estado
- Proporción mantenimiento preventivo vs. correctivo
- Equipos con fallas recurrentes

**Últimas OTs completadas**  
Lista de las 25 OTs más recientes con acceso directo a cada una.

**Navegación rápida**  
Acceso directo a los módulos más usados desde el menú lateral o superior.

---

## 5. Órdenes de Trabajo (OTs)

### 5.1 Ver listado de OTs

El listado principal muestra todas las OTs a las que tenés acceso según tu rol y centro.

**Filtros disponibles:**
- **Estado:** Pendiente / En curso / Completada / Cancelada
- **Tipo:** Preventiva / Correctiva / Checklist
- **Especialidad:** AA / Eléctrico / GG / HG
- **Búsqueda** por número de OT, aviso SAP, equipo o técnico

**Indicadores visuales:**
- Alerta naranja si existen avisos duplicados que requieren cierre
- Etiquetas de frecuencia: Mensual / Trimestral / Semestral / Anual

**Para técnicos:** solo aparecen OTs asignadas a tu usuario o a tu especialidad dentro del centro.

---

### 5.2 Crear una OT manual

> Requiere rol Supervisor, Admin o Superadmin.

1. Ir a **Tareas → Nueva OT**.
2. Completar los campos obligatorios:
   - **Tipo:** Preventiva, Correctiva o Checklist
   - **Equipo / Activo:** Buscar por código o nombre
   - **Ubicación técnica:** Se completa automáticamente al seleccionar el equipo
   - **Técnico asignado:** Elegir de la lista de técnicos del centro
   - **Fecha programada**
   - **Aviso SAP** (opcional, si se vincula a un aviso existente)
3. Hacer clic en **Crear OT**.

La OT queda en estado **Pendiente** y el técnico asignado recibe una notificación.

---

### 5.3 Detalle de una OT

Al abrir una OT, se accede a toda la información de la orden:

**Encabezado**
- Número de OT, tipo, estado actual
- Datos del equipo: código, denominación, ubicación técnica
- Técnico asignado y centro
- Fecha programada y fecha de ejecución

**Acciones disponibles según estado y rol:**

| Acción | Estado requerido | Rol mínimo |
|--------|-----------------|------------|
| Iniciar OT | Pendiente | Técnico |
| Completar OT | En curso | Técnico |
| Cancelar OT | Pendiente / En curso | Supervisor |
| Reasignar técnico | Pendiente | Supervisor |
| Descargar PDF | Completada + firmada | Admin |
| Registrar empalme | Cualquiera | Superadmin |

**Cambio de estado:**  
El flujo normal es: `Pendiente → En curso → Completada`.  
Una vez completada y firmada, la OT puede archivarse.

---

### 5.4 Planillas (formularios de trabajo)

Las planillas son formularios digitales asociados a la OT donde se registra el trabajo realizado.

#### Abrir la planilla

En el detalle de la OT, hacer clic en la pestaña **Planilla** o en el botón **Completar planilla**.

#### Tipos de campos

| Tipo | Descripción |
|------|-------------|
| Texto | Campo libre para observaciones o descripción del trabajo |
| Booleano / Checklist | Marcar como realizado (✅) o no realizado (❌) |
| Numérico | Lecturas de instrumentos, mediciones |
| Selección | Opciones predefinidas |

#### Indicador de progreso

La planilla muestra el porcentaje de completitud en tiempo real (ej: "7/10 ítems completados").

#### Guardar la planilla

Los datos se guardan automáticamente al completar cada campo. Si estás **sin conexión**, los cambios se almacenan localmente y se sincronizan cuando recuperás la conexión (ver sección 5.9).

#### Redacción asistida por IA

En campos de texto como "Trabajo realizado" u "Observaciones", hay un botón de **IA** que genera un borrador a partir de palabras clave ingresadas. Ver sección [11. Funciones de Inteligencia Artificial](#11-funciones-de-inteligencia-artificial).

---

### 5.5 Materiales

Dentro del detalle de la OT, la pestaña **Materiales** permite registrar los insumos y repuestos utilizados.

#### Agregar un material

1. Hacer clic en **+ Agregar material**.
2. Escribir el nombre o código del material (el sistema sugiere coincidencias del catálogo).
3. Ingresar la **cantidad** y la **unidad** (ej: 2 unidades, 0,5 litros).
4. Seleccionar el **origen**:
   - **ARAUCO**: material del stock de planta
   - **EXTERNO**: material adquirido externamente
5. Confirmar.

#### Visualización de stock

Si el módulo está habilitado, al buscar un material del catálogo se muestra la disponibilidad en stock.

#### Normalización automática (IA)

Cuando se ingresa un material con texto libre, el sistema puede asociarlo automáticamente a un ítem del catálogo normalizado. Este proceso ocurre en segundo plano y queda registrado en el historial. Los usuarios con rol Cliente no ven esta información.

---

### 5.6 Firmas digitales

El cierre formal de una OT requiere **dos firmas digitales**:

1. **Firma SEAM** (técnico o supervisor SEAM): certifica que el trabajo fue ejecutado.
2. **Firma Planta** (representante de Arauco/cliente): valida y acepta el trabajo.

#### Proceso de firma

1. Completar todos los ítems de la planilla.
2. Ir a la pestaña **Firma** o al botón **Firmar**.
3. El firmante SEAM firma primero.
4. Luego el representante de planta firma en su portal.

> Según la configuración del centro, ambas firmas pueden ser obligatorias para habilitar la descarga del PDF.

**Estados de la planilla:**
- **Borrador** → en progreso, sin firmar
- **Firmada SEAM** → firmada por el técnico, pendiente firma planta
- **Completada** → ambas firmas registradas, PDF disponible

---

### 5.7 Historial y auditoría

Cada OT mantiene un registro completo de todos los eventos:

| Tipo de evento | Descripción |
|---------------|-------------|
| `estado_cambio` | Cambio de estado de la OT |
| `material_agregado` | Material registrado |
| `firma` | Firma digital registrada |
| `normalización_ia` | Material normalizado por IA |
| `empalme` | Registro histórico manual |
| `comentario` | Comentario de usuario |

Cada evento muestra: **fecha y hora**, **actor** (nombre de usuario) y **descripción**.

#### Exportar historial

Hacer clic en **Exportar CSV** para descargar el historial completo de la OT en formato planilla.

#### Comentarios

En la sección de comentarios, cualquier usuario con acceso puede dejar notas o mensajes relacionados con la OT.

---

### 5.8 Descarga de PDF

> Disponible para Admin, Superadmin y Cliente (solo OTs completadas y firmadas).

1. Abrir la OT deseada.
2. Verificar que esté en estado **Completada** y con ambas firmas registradas.
3. Hacer clic en **Descargar PDF**.
4. El documento se genera y descarga automáticamente.

El PDF incluye: datos de la OT, equipo, técnico, trabajo realizado, ítems del checklist, materiales consumidos y firmas.

---

### 5.9 Uso sin conexión (offline)

El sistema permite trabajar en campo sin conexión a internet. Cuando no hay conectividad:

- Aparece un **banner naranja** indicando "Sin conexión".
- Se muestra el **contador de cambios pendientes** de sincronización.
- Los cambios se almacenan localmente (checklist, materiales, planilla).

Al recuperar la conexión:
- Los cambios pendientes se sincronizan automáticamente.
- El banner desaparece y el contador vuelve a cero.

> **Importante:** No cerrar ni recargar el navegador mientras haya cambios pendientes sin sincronizar.

---

## 6. Programa Semanal

### 6.1 Vista del programa

El programa semanal muestra la planificación de mantenimiento de la semana actual organizada por día y especialidad.

**Columnas:** AA | Eléctrico | GG  
**Filas:** Lunes a Domingo

Cada celda puede contener uno o más **avisos SAP** programados para ese día y especialidad.

**Código de colores:**
- 🔴 Rojo: urgente / vencido
- 🟡 Amarillo/Naranja: correctivo
- ⬜ Gris: preventivo estándar

**Navegación:**  
Usar los botones `← semana anterior` / `semana siguiente →` para cambiar de semana. La vista muestra el rango de fechas (ej: "28 abr – 3 may").

---

### 6.2 Vencimientos SA (semi-anual/anual)

El módulo de vencimientos permite controlar el estado de todos los avisos de mantenimiento **semi-anual y anual**.

#### Tarjetas KPI

| Tarjeta | Significado |
|---------|-------------|
| Sin historial | Avisos que nunca tuvieron ejecución |
| Vencidos | Avisos con fecha de vencimiento pasada |
| Próximos (30 días) | Vencen dentro del mes |
| En plazo | Sin urgencia |
| Total SA | Total de avisos S/A del centro |

#### Filtros

- **Especialidad:** AA / Eléctrico / HG / Todas
- **Estado:** Todos / Vencidos / Próximos / OK
- **Frecuencia:** Todos / Semi-anual / Anual
- **Centro:** (solo Superadmin)

#### Pestañas

- **Con historial de ejecución:** Avisos que tienen al menos una ejecución anterior, con fecha y OT de referencia.
- **Sin orden de trabajo:** Avisos preventivos que nunca fueron vinculados a una OT.

#### Información por aviso

Para cada aviso se muestra:
- Número de aviso y descripción del equipo
- Última ejecución (fecha y número de OT)
- OT actualmente abierta para ese aviso (si existe)
- Advertencia si hay un aviso predecesor pendiente de cierre

---

### 6.3 Crear OT desde un aviso

1. En la vista de vencimientos o programa, localizar el aviso.
2. Hacer clic en **Crear OT**.
3. Confirmar los datos (se pre-completan desde el aviso).
4. La OT queda vinculada al aviso y se actualiza el estado del vencimiento.

> Si existe una OT abierta para ese aviso o un predecesor sin cerrar, el sistema muestra una advertencia antes de permitir la creación.

---

### 6.4 Agregar aviso al programa semanal

1. Localizar el aviso en vencimientos.
2. Hacer clic en **Agregar al programa**.
3. Seleccionar la **semana ISO** y el **día de la semana**.
4. Confirmar. El aviso aparece en el programa semanal del día elegido.

---

### 6.5 Aprobación y publicación

> Requiere rol Supervisor, Admin o Superadmin.

El programa semanal pasa por un proceso de aprobación antes de ser visible para el cliente.

1. Ir a **Programa → Aprobación**.
2. Revisar el estado del motor de propuestas para el centro.
3. Controlar los avisos asignados a cada día de la semana.
4. Hacer clic en **Publicar programa**.
5. El programa queda visible en el **Portal del Cliente**.

---

## 7. Activos (Equipos)

El módulo de activos es el catálogo de todos los equipos registrados en el sistema.

### Buscar un activo

1. Ir a **Activos** desde el menú.
2. Usar la barra de búsqueda (código, nombre, ubicación).
3. Aplicar filtros:
   - **Centro (planta)**
   - **Ubicación técnica**
   - **Estado operativo** (activo / inactivo)
   - **Especialidad**

### Ver detalle de un activo

Hacer clic en un activo para ver:
- Código nuevo y código legacy
- Denominación del equipo
- Ubicación técnica
- Centro asignado
- Estado operativo
- Especialidad / disciplina
- Historial de OTs asociadas

### Código QR

Cada activo tiene un **código QR** que puede escanearse desde un dispositivo móvil para acceder directamente a su ficha y OTs activas.

### Crear / editar activos

> Requiere rol Admin o Superadmin.

1. Ir a **Activos → Nuevo activo** o abrir uno existente y hacer clic en **Editar**.
2. Completar o actualizar los campos.
3. Guardar.

Para carga masiva, usar la importación por Excel (ver sección 14).

---

## 8. Materiales — Reportes

El módulo de reportes de materiales permite analizar el consumo de insumos y repuestos por período, especialidad, tipo de mantenimiento y centro.

### Acceder al reporte

Ir a **Materiales** desde el menú lateral.

### Filtros disponibles

| Filtro | Opciones |
|--------|---------|
| Tipo de OT | Preventiva / Correctiva / Todos |
| Especialidad | AA / Eléctrico / GG / HG / Todas |
| Origen | ARAUCO / EXTERNO / Todos |
| Período | Selección por mes |
| Centro | Por planta (Superadmin) |

### Visualizaciones

- **Totales:** Cantidad de ítems, volumen total consumido
- **Gráfico de torta — Origen:** Proporción ARAUCO vs. EXTERNO
- **Gráfico de torta — Tipo:** Preventivo vs. Correctivo

### Tabla de detalle

Columnas: Descripción | Cantidad | Unidad | Origen | N° OT | Tipo | Fecha

Los resultados se muestran paginados (20 por página).

### Agrupado por OT

Alternar a la vista **Por OT** para ver los materiales agrupados por orden de trabajo, con:
- Número de aviso y especialidad
- Cantidad de ítems
- Desglose ARAUCO / EXTERNO
- Sub-tabla expandible con el detalle de cada material

### Exportar

Hacer clic en **Exportar CSV** para descargar todos los resultados con los filtros aplicados.  
El archivo incluye: descripción, cantidad, unidad, origen, número de OT, tipo y fecha.

---

## 9. Portal del Cliente (Arauco)

El portal del cliente permite a los representantes de Arauco ver el estado del servicio de mantenimiento.

### Acceso

El cliente accede con su usuario y contraseña. Al ingresar, ve directamente el dashboard de cliente.

### Programa semanal publicado

- Visualización del programa de la semana actual
- Grilla por especialidad y día de la semana
- Código de colores de avisos (urgente / correctivo / estándar)
- Solo visible después de que el Supervisor publica el programa

### OTs activas

- Listado de órdenes en curso o completadas del centro
- Estado actual de cada orden
- Acceso de solo lectura a la planilla y checklist

### Firma de planilla (Planta)

El cliente puede **firmar digitalmente** la planilla como representante de planta:
1. Abrir la OT correspondiente.
2. Ir a la pestaña **Firma**.
3. Firmar como representante de Arauco.

### Descarga de PDF

Una vez firmada la planilla por ambas partes (SEAM + Planta), el cliente puede descargar el PDF de la OT.

### Restricciones del cliente

- **No puede** crear ni modificar OTs.
- **No puede** ver detalles de materiales de proveedores externos ni datos de normalización IA.
- **No puede** ver el historial de auditoría interno.
- **No puede** gestionar usuarios ni configuración.

---

## 10. Notificaciones

### Campana de notificaciones

En la barra superior aparece el ícono de campana con el **contador de notificaciones no leídas**.

### Tipos de notificaciones

| Tipo | Descripción |
|------|-------------|
| OT asignada | Te asignaron una nueva orden |
| OT próxima a vencer | Una OT tiene fecha inminente |
| Mantenimiento vencido | Un aviso preventivo venció |
| Firma requerida | Una planilla requiere tu firma |
| Solicitud de material | Nuevo material registrado |

### Gestionar notificaciones

- **Marcar como leída**: hacer clic en la notificación.
- **Eliminar**: ícono de papelera en cada notificación.
- **Limpiar todas**: botón "Limpiar" en el panel.

### Notificaciones push (navegador)

Si el navegador lo permite, podés recibir notificaciones push aunque la aplicación esté minimizada:

1. Ir a **Perfil → Notificaciones**.
2. Activar **Notificaciones push**.
3. Aceptar el permiso del navegador.

Para desactivarlas, ir al mismo lugar y hacer clic en **Desuscribirse**.

---

## 11. Funciones de Inteligencia Artificial

> Disponible para roles Admin y Superadmin, si el módulo está habilitado en el centro.

### Redacción asistida en planillas

Al completar campos de texto en la planilla (como "Trabajo realizado" u "Observaciones"):

1. Hacer clic en el ícono de **IA** junto al campo.
2. Ingresar **palabras clave** que describan lo realizado (ej: "cambio filtro, limpieza, revisión general").
3. El sistema genera un texto sugerido.
4. Editarlo si es necesario y confirmar.

El texto generado se inserta en el campo y queda registrado como texto del usuario, no como contenido de IA.

### Transcripción de audio

En campos de observaciones de la planilla:

1. Hacer clic en el ícono de **micrófono**.
2. Hablar para dictar la observación.
3. El audio se transcribe automáticamente al campo de texto.

### Normalización de materiales

Cuando se ingresa un material con texto libre, el sistema puede asociarlo automáticamente al ítem equivalente en el catálogo normalizado. Este proceso ocurre en segundo plano y queda registrado en el historial como evento `normalización_ia`.

> Esta información no es visible para usuarios con rol Cliente.

---

## 12. Administración — Gestión de Usuarios

> Requiere rol Admin o Superadmin.

### Acceder a la gestión de usuarios

Ir a **Superadmin → Usuarios** o **Admin → Usuarios** según el rol.

### Ver el directorio de usuarios

La tabla muestra todos los usuarios del sistema (o del centro, para Admins) con:
- Nombre y correo electrónico
- Rol asignado (con badge de color)
- Centro(s) asignado(s)
- Estado: activo / inactivo

### Crear un usuario

1. Hacer clic en **+ Nuevo usuario**.
2. Ingresar el correo electrónico del nuevo usuario.
3. Asignar **rol** (Técnico, Supervisor, Admin, etc.).
4. Asignar **centro(s)**.
5. Seleccionar **especialidades** si aplica.
6. Confirmar. El usuario recibirá un correo para configurar su contraseña.

### Editar un usuario existente

1. Hacer clic en el usuario de la lista.
2. Modificar rol, centro o especialidades.
3. Guardar.

### Asignación de especialidades

Para técnicos y supervisores es posible limitar la visibilidad a especialidades específicas:
- Marcar las especialidades habilitadas: AA / Eléctrico / GG / HG
- El usuario solo verá OTs y avisos de sus especialidades asignadas

### Asignación multi-centro (Técnicos)

Los técnicos pueden ser asignados a **más de un centro**. Seleccionar todos los centros correspondientes en el panel de edición.

---

## 13. Configuración del Sistema (Superadmin)

> Solo para Superadmin.

Acceder desde **Superadmin → Configuración**.

### Pestaña: General

Configuración por centro (planta):

| Ajuste | Descripción |
|--------|-------------|
| Módulo Activos | Habilitar/deshabilitar el catálogo de activos |
| Módulo Materiales | Habilitar el registro de materiales |
| Módulo IA | Habilitar funciones de inteligencia artificial |
| Especialidades activas | Qué especialidades opera el centro |
| Doble firma obligatoria | Requerir firma SEAM + Planta para cerrar OT |

### Pestaña: Motor / Propuestas

Control del algoritmo de generación de programas semanales:

- Ver estado del motor para cada centro
- Forzar regeneración de propuestas
- Revisar diagnósticos de propuestas

### Pestaña: Importación

Ver sección [14. Importación de datos](#14-importación-de-datos-excel--avisos).

---

## 14. Importación de datos (Excel / Avisos)

> Requiere rol Admin o Superadmin.

### Importar activos desde Excel

1. Ir a **Configuración → Importación** o **Activos → Importar**.
2. Descargar la **plantilla Excel** de ejemplo.
3. Completar la planilla con los datos de los equipos.
4. Subir el archivo.
5. El sistema valida las columnas y reporta errores.
6. Confirmar la importación.

**Columnas requeridas:** Código, Denominación, Ubicación Técnica, Centro, Especialidad, Estado Operativo.

### Importar avisos / programa

1. Ir a **Configuración → Importación de avisos**.
2. Subir el archivo de avisos (formato SAP o planilla definida).
3. Validar y confirmar.

Los avisos importados quedan disponibles en el módulo de Vencimientos y en el programa semanal.

---

## 15. Perfil de usuario

### Acceder al perfil

Hacer clic en el avatar o nombre de usuario en la esquina superior derecha → **Perfil**.

### Información disponible

- Nombre completo
- Correo electrónico
- Rol asignado
- Centro(s) asignado(s)
- Especialidades

### Cambiar contraseña

Desde el perfil, hacer clic en **Cambiar contraseña** e ingresar la contraseña actual y la nueva.

### Configurar notificaciones push

Desde el perfil, activar o desactivar las **notificaciones push del navegador**.

---

## 16. Preguntas frecuentes y solución de problemas

---

**¿Por qué no puedo ver ciertas OTs?**  
El acceso a OTs depende de tu rol y centro asignado. Los técnicos solo ven OTs asignadas a ellos o a su especialidad. Si creés que falta acceso, contactá al administrador.

---

**¿Por qué no puedo crear una OT?**  
La creación de OTs requiere rol Supervisor, Admin o Superadmin. Si tenés rol Técnico, necesitás que un supervisor la cree y te la asigne.

---

**Completé la planilla pero no puedo descargar el PDF.**  
El PDF solo está disponible cuando la OT está en estado **Completada** y tiene **ambas firmas digitales** registradas (SEAM y Planta). Verificá que ambas firmas estén completas.

---

**El sistema dice que hay un "predecesor pendiente de cierre".**  
Significa que existe un aviso anterior relacionado con ese equipo que tiene una OT abierta que debe cerrarse antes de crear una nueva. Cerrá la OT mencionada y luego reintentá.

---

**Trabajé offline y mis cambios no se guardaron.**  
Si cerraste el navegador o la pestaña antes de que se sincronicen los cambios, es posible que se hayan perdido. Siempre esperá a que el contador de "cambios pendientes" llegue a cero antes de cerrar la aplicación.

---

**No recibo notificaciones push.**  
Verificá que:
1. Las notificaciones estén activadas en tu perfil.
2. El navegador tenga permiso para mostrar notificaciones (en la configuración del navegador).
3. No estés en modo silencio o "no molestar" en tu sistema operativo.

---

**¿Cómo accede un cliente Arauco al sistema?**  
El cliente recibe un usuario y contraseña del administrador de SEAM. No puede auto-registrarse. Al ingresar, solo ve el portal de cliente con el programa publicado y sus OTs.

---

**¿Cómo registro trabajo realizado en el pasado (empalme histórico)?**  
Esta función está disponible solo para Superadmin. En el detalle de la OT, hacer clic en **Registrar empalme**. Se solicita: fecha de ejecución, motivo, nombre del técnico y URL de evidencia.

---

**El módulo de IA no aparece.**  
El módulo de IA debe estar habilitado para el centro en la configuración (Superadmin → Configuración → General → Módulo IA). Si está habilitado y no lo ves, verificá que tu rol sea Admin o Superadmin.

---

*Para soporte técnico, contactar al equipo SEAM o al administrador del sistema.*

---

**Fin del Manual de Usuario — CMMS Industrial SEAM**  
*Versión Mayo 2026*
