# ConfortVets — Documento de diseño

> **Más tiempo para cuidar.**
> Software de gestión para veterinarios independientes, desarrollado por NovaStudio.

Estado: **versión 1 implementada** (fases 0 a 6). Ver el README para ponerla en marcha y la sección 14 de este documento para lo que está verificado y lo que falta. La sección 13 (marco legal) sigue **pendiente de revisión por un abogado**.

---

## 1. Principios

1. **Un producto, un código, una base de datos.** ConfortVets es un solo proyecto (repositorio, Supabase, Netlify). Los veterinarios son **organizaciones** dentro de él. No se crea código ni proyecto de Supabase por cliente.
2. **Todo lo que se pueda vive en la base de datos, no en el despliegue.** Netlify solo sirve el código. Usuarios, permisos, módulos, catálogos, textos, plantillas, marca y reglas están en Postgres.
3. **Parametrizable por organización**, con estructura fija para lo clínico y campos personalizados para lo adicional (sección 7).
4. **Seguridad en la base de datos (RLS), no solo en pantalla.** Si alguien llama a la API directo, la base de datos igual le niega lo que no le corresponde.
5. **Los registros clínicos no se borran.** Se anulan con motivo o se corrigen con notas aclaratorias. Todo queda en bitácora.
6. **Ahorrar espacio.** Imágenes comprimidas al subir, PDF con límite, cuota por organización, documentos imprimibles generados al momento (no guardados).
7. **Mejoras de un solo cliente = módulo apagado por defecto** que el super admin enciende para esa organización, o un parámetro por organización.

---

## 2. Marca

- **Producto:** ConfortVets. Eslogan: *Más tiempo para cuidar.*
- **Logo del producto:** "C" con huella y corazón, degradado azul → verde azulado, sobre fondo oscuro (archivo entregado por el dueño).
- **Pantalla de inicio de sesión:** logo y eslogan de ConfortVets en grande. No hay datos de ninguna organización (aún no se sabe quién entra).
- **Después de iniciar sesión:** encabezado, menú y documentos usan **la marca del veterinario** (nombre comercial, logo, color). El logo y el nombre de ConfortVets quedan visibles pero secundarios (pie del menú).
- **Pie de página:** "Desarrollado por **NovaStudio**". Al hacer clic en NovaStudio abre WhatsApp `573193034610` con el mensaje "Hola NovaStudio, quiero información sobre ConfortVets." (mismo patrón que `components/brand-footer.tsx` de Stockia).
- **Por organización (en base de datos):** nombre comercial, logo, color principal (por defecto el degradado de ConfortVets), nombre del profesional, tarjeta profesional, teléfono, dirección, ciudad, WhatsApp, texto de membrete.

---

## 3. Arquitectura

| Capa | Decisión |
|---|---|
| Aplicación | Next.js (App Router) + TypeScript + Tailwind, misma línea que Stockia |
| Base de datos y auth | Supabase (Postgres, Auth, Storage) |
| Hosting | Netlify |
| Repositorio | `c:\NovaStudio\vet`, repositorio propio en GitHub |
| Validación | Zod, en servidor (server actions) y reutilizada en formularios |
| Lógica de negocio | Funciones puras en `lib/logic/` con pruebas (recordatorios, fechas, cuotas, permisos) |
| Migraciones | SQL versionado en `supabase/migrations/` (como VenuSpa); la base se reconstruye desde cero con ellas |
| Correo | Fuera de la primera versión (recordatorios por WhatsApp manual) |

Estructura propuesta de carpetas:

```
vet/
  app/                 rutas (login, dashboard, superadmin)
  components/
  lib/
    actions/           server actions por módulo
    logic/             reglas puras con pruebas
    supabase/          clientes (server, browser, admin)
    permissions.ts     catálogo de permisos y chequeos
  supabase/migrations/ esquema versionado
  scripts/             bootstrap del super admin, respaldo, utilidades
  docs/                este documento y el manual
```

**Entornos.** El plan gratis solo permite 2 proyectos de Supabase (uno ya es Stockia), así que al inicio **no habrá un ambiente de pruebas separado**. Mientras no haya clientes reales se trabaja directo sobre el proyecto de ConfortVets. Cuando entre el primer cliente que pague, se pasa a Pro y se crea un segundo proyecto para pruebas.

---

## 4. Organizaciones, usuarios y roles

### Roles

| Rol | Qué es | Alcance |
|---|---|---|
| `super_admin` | NovaStudio | Gestiona organizaciones, módulos, límites, usuarios. **No lee datos clínicos** por el panel (ver 8) |
| `owner` | El veterinario, uno por organización | Todo lo de su organización; crea auxiliares y les da permisos |
| `auxiliar` | Asistentes creados por el owner | Solo los permisos que el owner le dio, dentro de lo que el módulo y la organización permiten |

### Inicio de sesión

- Por **usuario y contraseña** (no por correo), como Stockia. Internamente Supabase Auth usa un correo aleatorio `<uuid>@confortvets.internal` (no expone el usuario).
- El nombre de usuario es **único en todo el sistema**.
- Bloqueo temporal tras varios intentos fallidos (tabla `login_attempts`).
- Contraseña mínima definida en un solo lugar (validación Zod); recomendación: 10 caracteres.

### Contraseñas

- El **owner** cambia la contraseña de cualquiera de sus auxiliares **sin conocer la anterior**. Es una acción de servidor con la llave de servicio. Verifica antes que el solicitante sea `owner` y que el auxiliar pertenezca a **su misma organización**. Queda en bitácora.
- El **owner** cambia la suya (con la actual) desde "Mi cuenta".
- El **super admin** restablece la contraseña de un owner (porque no hay nadie por encima).
- Opción `must_change_password`: al restablecer, el usuario debe cambiarla en su próximo ingreso.

### Activar y desactivar

- `organizations.is_active`: si está en falso, **nadie** de esa organización entra (se valida en la sesión y en RLS).
- `profiles.is_active`: bloquea a un usuario concreto. Lo pueden usar el super admin y el owner (sobre sus auxiliares).
- `organizations.valid_until`: fecha de vencimiento (membresía). Aviso desde 7 días antes. **Decidido:** al vencer, la organización queda en **solo lectura**: puede consultar, imprimir y exportar, pero no crear ni modificar registros. Se muestra un mensaje permanente: *"Tu membresía ha vencido. Actualízala para seguir registrando información."* con un botón que abre WhatsApp de NovaStudio. Se aplica en la aplicación y en RLS (función `is_membership_active()` exigida en toda política de escritura). Si `organizations.is_active` es falso, el bloqueo es total.

---

## 5. Módulos y permisos

### Módulos (catálogo `modules`, activables por organización)

| Clave | Nombre | Núcleo | Primera versión |
|---|---|---|---|
| `core` | Tutores, pacientes, usuarios, configuración | Sí (siempre activo) | Sí |
| `clinical` | Historia clínica, exámenes, fórmulas | | Sí |
| `preventive` | Vacunas, desparasitación y recordatorios | | Sí |
| `consents` | Autorizaciones con firma | | Sí |
| `agenda` | Citas y lista de espera | | Versión 2 |
| `inventory` | Medicamentos, insumos, ventas y caja | | Versión 2 |
| `hospital` | Hospitalización y cirugía | | Versión 3 |
| `portal` | Portal del tutor | | Versión 3 |

Un módulo nuevo se agrega como una fila en `modules` y queda apagado para todos hasta que el super admin lo encienda.

### Permisos

Catálogo `permissions` (clave, módulo, descripción). Ejemplos: `patients.read`, `patients.write`, `clinical.read`, `clinical.write`, `clinical.close`, `clinical.void`, `preventive.write`, `consents.sign`, `files.upload`, `settings.write`.

- El **owner** tiene todos los permisos de los módulos activos.
- A cada **auxiliar** el owner le asigna permisos (`auxiliary_permissions`). Solo puede asignar permisos de módulos activos para su organización.
- El **super admin** puede restringir permisos concretos por organización (`organization_permissions`).
- Se validan en **dos sitios**: la aplicación (menú y server actions) y **RLS** mediante `has_module()` y `has_permission()`.

---

## 6. Modelo de datos

Toda tabla de negocio lleva `organization_id`, `created_at`, `created_by`, `updated_at` y tiene RLS. Las claves primarias son `uuid`.

### 6.1 Núcleo

| Tabla | Contenido |
|---|---|
| `organizations` | nombre, slug, `is_active`, `valid_until`, `max_auxiliares`, `storage_quota_mb`, notas internas |
| `organization_settings` | marca (logo, color, nombre del profesional, tarjeta profesional, teléfono, dirección, ciudad, WhatsApp, membrete), zona horaria (`America/Bogota`), moneda |
| `profiles` | id (= `auth.users.id`), `organization_id` (nulo para super admin), usuario, nombre, rol, `is_active`, `must_change_password`, último ingreso |
| `modules` | clave, nombre, descripción, `is_core`, orden |
| `organization_modules` | organización, módulo, habilitado |
| `permissions` | clave, módulo, descripción |
| `organization_permissions` | restricciones por organización puestas por el super admin |
| `auxiliary_permissions` | permisos asignados a cada auxiliar |
| `activity_log` | quién, qué, sobre qué, cuándo, detalle (solo se inserta; nunca se edita ni borra) |
| `login_attempts` | control de intentos fallidos |
| `files` | registro de cada archivo subido: ruta, tipo, tamaño en bytes, entidad asociada; sirve para la cuota |

### 6.2 Tutores y pacientes

| Tabla | Contenido |
|---|---|
| `tutors` | nombre, cédula (única por organización), teléfono, WhatsApp, correo, dirección, barrio, ciudad, `custom_fields`, consentimiento de contacto y fecha (habeas data), `is_active` |
| `species` | por organización; se siembran *Canino* y *Felino*; editable |
| `breeds` | por organización y especie; selección o texto libre en el paciente |
| `patients` | tutor, nombre, especie, raza (id o texto), sexo, color, fecha de nacimiento (con marca de "aproximada"), microchip, esterilizado, alergias, antecedentes, foto, estado (`activo` / `fallecido`), fecha y motivo de fallecimiento, `custom_fields` |
| `patient_weights` | paciente, peso, fecha, consulta asociada (si la hay); alimenta la curva de peso |

### 6.3 Historia clínica

| Tabla | Contenido |
|---|---|
| `control_types` | catálogo editable: *Control de examen de laboratorio*, *Chequeo preventivo*, *Control por enfermedad* |
| `consultations` | paciente, `kind` (`consulta` / `control`), consulta de origen (para controles), fecha, profesional, **motivo**, **anamnesis**, peso, temperatura, FC, FR, mucosas, TLLC, turgencia cutánea (columna `hydration`), condición corporal, **diagnósticos diferenciales**, **diagnóstico definitivo**, **tratamiento**, **recomendaciones**, tipo de control, próxima fecha de control, `custom_fields`, estado (`borrador` / `cerrada` / `anulada`), quién y cuándo cerró o anuló, motivo de anulación |
| `consultation_addenda` | notas aclaratorias posteriores al cierre; solo se agregan |
| `exam_files` | consulta, paciente, nombre, tipo de examen, archivo (vía `files`), notas |
| `prescriptions` | consulta, número consecutivo por organización, fecha, profesional, observaciones |
| `prescription_items` | medicamento, presentación, dosis, frecuencia, duración, vía, indicaciones, orden |
| `medications` | catálogo editable (se puede escribir un medicamento libre en la fórmula) |
| `text_templates` | plantillas de texto por tipo (anamnesis, diagnóstico, tratamiento, recomendaciones) |

### 6.4 Preventivo y recordatorios

| Tabla | Contenido |
|---|---|
| `vaccine_catalog` | nombre, especie, días de refuerzo por defecto |
| `vaccinations` | paciente, vacuna, **fecha de aplicación**, **lote**, **fecha de vencimiento**, **próxima aplicación**, peso, temperatura, estado general, estado (`aplicada` / `anulada`) |
| `deworming_products` | nombre, tipo (`interna` / `externa` / `ambas`), días de refuerzo |
| `dewormings` | paciente, tipo, producto, **fecha**, **lote**, **vencimiento**, **fecha de refuerzo**, peso, temperatura, estado general |
| `reminder_rules` | una regla por organización y tipo: cuántos días antes de la fecha aparece el recordatorio en «Recordatorios» (por defecto 7, 7 y 3), activa o no |
| `message_templates` | texto de WhatsApp por tipo, con variables `{tutor}`, `{paciente}`, `{fecha}`, `{clinica}` |
| `reminders` | paciente, tutor, tipo (`vacuna` / `desparasitante` / `control`), tipo de control, fecha, origen, estado (`pendiente` / `enviado` / `hecho` / `descartado`), quién y cuándo, texto enviado |

Los recordatorios se generan cuando se registra una fecha de próxima aplicación o de refuerzo. Se muestran en una pantalla "Pendientes de hoy"; cada uno abre WhatsApp (`wa.me`) con el mensaje ya escrito y se marca como enviado.

### 6.5 Autorizaciones

| Tabla | Contenido |
|---|---|
| `consent_templates` | tipo (`vacuna` / `anestesia` / `procedimiento` / `eutanasia` / `otro`), título, texto con variables, versión, activa |
| `consents` | paciente, tutor, consulta (opcional), plantilla, **título y texto tal como se firmaron** (copia congelada), hash del contenido, descripción del procedimiento, estado (`pendiente` / `firmada` / `rechazada` / `anulada`), fecha de firma, nombre y cédula del firmante, método (`en pantalla` / `archivo subido`), firma o archivo (vía `files`), IP, navegador |

Si se edita la plantilla después, las autorizaciones ya firmadas **no cambian** (se guardó la copia).

### 6.6 Campos personalizados

| Tabla | Contenido |
|---|---|
| `custom_field_defs` | entidad (`tutor` / `patient` / `consultation`), sección, clave, etiqueta, tipo (`texto` / `número` / `lista` / `sí-no` / `fecha`), opciones, obligatorio, orden, activo |

Los valores van en la columna `custom_fields jsonb` de cada entidad. La aplicación valida contra las definiciones.

---

## 7. Parametrización

Término medio, para que sea poderoso sin volverse inmanejable:

1. **Estructura clínica fija** (columnas reales): lo que el veterinario ya definió. Permite buscar, ordenar y hacer reportes.
2. **Catálogos editables por organización:** especies, razas, vacunas, desparasitantes, medicamentos, tipos de control, plantillas de texto, plantillas de autorización, textos de WhatsApp, reglas de recordatorio, membrete.
3. **Campos personalizados** por organización para lo que haga falta añadir (sección 6.6).
4. **Constructor completo de formularios:** fuera de alcance por ahora. Las tablas quedan diseñadas para no impedirlo después.

Al crear una organización, una función de base de datos **copia los catálogos por defecto** (Canino, Felino, razas comunes, vacunas y desparasitantes habituales, textos de autorización y de WhatsApp) a esa organización. Desde ahí cada una los edita sin afectar a las demás.

---

## 8. Seguridad

- **RLS en todas las tablas.** Funciones auxiliares: `current_org()`, `is_super_admin()`, `has_module(clave)`, `has_permission(clave)`, `is_org_active()`.
- **Aislamiento entre veterinarios:** una organización nunca ve filas de otra. Se prueba con scripts (sección 11).
- **El super admin no lee datos clínicos ni de tutores** desde el panel: ve organizaciones, módulos, límites, usuarios, uso de espacio y bitácora. Si algún día necesita ver datos para dar soporte, se hace por una vía separada y registrada. **Decidido.**
- **Llave de servicio** (`service_role`) solo en servidor y solo en las acciones que lo necesitan (crear usuarios, restablecer contraseñas, subir/consultar archivos con cuota). Nunca en el navegador.
- **Registros inmutables:** consultas cerradas, vacunaciones, autorizaciones firmadas y bitácora no se actualizan ni se borran. RLS y disparadores lo impiden; las correcciones son anulaciones o notas aclaratorias.
- **Archivos privados:** bucket privado, ruta `<organization_id>/<tipo>/<uuid>.<ext>`, políticas por organización, URL firmadas de corta duración.
- **Datos personales (Ley 1581 de 2012, Colombia):** consentimiento de contacto en el tutor, política de tratamiento visible en la aplicación. A confirmar con un abogado el texto exacto.
- **Cabeceras y sesión:** cookies seguras, protección CSRF propia de server actions, cabeceras de seguridad en `next.config`.
- **Bitácora:** inicios de sesión, cambios de contraseña, creación y desactivación de usuarios, cierre y anulación de registros, firma de autorizaciones, cambios de módulos y permisos.

---

## 9. Almacenamiento y cuotas

- Todo archivo se registra en `files` con su tamaño. La cuota usada de una organización es la suma de sus archivos.
- Antes de subir, la acción de servidor comprueba que **usado + nuevo ≤ cuota**. Si no, rechaza con un mensaje claro.
- **Imágenes** (logo, fotos de pacientes, fotos de examen): se redimensionan y convierten a WebP al subir (≈ 50–150 KB).
- **PDF de exámenes:** límite por archivo (propuesta: 5 MB), configurable.
- **Firma en pantalla:** PNG pequeño (unos KB).
- **Documentos imprimibles** (fórmula, carné, certificado, autorización): se generan desde la base de datos y se imprimen o guardan como PDF desde el navegador. **No se almacenan.**
- El super admin ve el uso por organización y ajusta la cuota.

---

## 10. Documentos imprimibles

Páginas con estilos de impresión, con el membrete del veterinario (logo, nombre, tarjeta profesional, teléfono, dirección) y el pie de ConfortVets:

- Fórmula médica (con número consecutivo).
- Carné de vacunación y desparasitación.
- Certificado de salud.
- Autorización firmada.
- Resumen de historia clínica del paciente.

---

## 11. Fases y criterios de "terminado"

Cada fase se construye, se prueba y se aprueba antes de empezar la siguiente.

| Fase | Contenido | Se da por terminada cuando |
|---|---|---|
| **0. Base** | Repositorio, proyecto Next, proyecto Supabase, Netlify, variables de entorno, migración inicial, marca (pantalla de login con logo y eslogan, pie con WhatsApp) | La aplicación vacía se despliega en Netlify y la pantalla de inicio se ve bien en celular y escritorio |
| **1. Núcleo multi-organización** | Auth por usuario, bootstrap del super admin, organizaciones, módulos, permisos, límites, vencimiento, auxiliares, cambio de contraseña, desactivación, bitácora, marca por organización, respaldo semanal cifrado | El super admin crea una organización con su owner; el owner crea un auxiliar y le cambia la contraseña sin conocer la anterior; apagar un módulo, un auxiliar o la organización bloquea el acceso; **un usuario de la organización A no puede leer nada de la B** (prueba automática) |
| **2. Tutores y pacientes** | Altas y edición, búsqueda, catálogos de especies y razas, foto, microchip, alergias, campos personalizados, curva de peso | Se crean tutores con varios pacientes, se buscan, se editan y los campos personalizados aparecen y se guardan |
| **3. Historia clínica** | Consulta y control, signos vitales, exámenes en PDF, fórmula imprimible, cierre, anulación, notas aclaratorias, plantillas de texto | Una consulta cerrada no se puede modificar; las correcciones quedan como notas; la fórmula se imprime con membrete; la cuota bloquea subidas excedidas |
| **4. Preventivo y recordatorios** | Vacunas, desparasitación, catálogos, reglas, mensajes de WhatsApp, pantalla de pendientes, carné imprimible | Registrar una vacuna con refuerzo genera el recordatorio y abre WhatsApp con el mensaje correcto |
| **5. Autorizaciones** | Plantillas por tipo, llenado automático con datos del tutor y del paciente, firma en pantalla o archivo subido, copia congelada, hash | Una autorización firmada queda inmodificable y sigue mostrando el texto original aunque cambie la plantilla |
| **6. Cierre de la versión 1** | Certificado de salud, exportación de datos de una organización, pruebas de seguridad, manual, revisión general | Lista de verificación de seguridad completa y manual entregado |

Versión 2: agenda (reutilizando la lógica de VenuSpa) e inventario y caja.
Versión 3: hospitalización y cirugía, portal del tutor.

---

## 12. Riesgos y puntos por confirmar

1. **Marco legal (historia clínica, datos personales, firma, consentimientos):** ver la **sección 13**. Todo ese bloque debe ser revisado por un abogado antes de vender.
2. **Decidido:** el super admin no lee datos clínicos (sección 8) y una organización vencida queda en solo lectura con aviso de membresía (sección 4).
5. **Netlify gratis:** verificar en sus términos que permite uso comercial y que soporta la versión de Next.js elegida antes de la Fase 0.
6. **Límites de Supabase gratis** (500 MB de base de datos, 1 GB de archivos, pausa tras 7 días sin actividad, sin copias automáticas): verificar cifras vigentes. El respaldo semanal cifrado entra en la Fase 1 porque el plan gratis no hace copias.
7. **Sin ambiente de pruebas separado** hasta pasar a Pro (ver sección 3).
8. **Un paciente tiene un tutor principal.** Varios tutores por paciente queda para más adelante.
9. **Facturación electrónica (DIAN):** no aplica hasta el módulo de inventario y caja; se evaluará entonces.

---

## 13. Marco legal — PENDIENTE DE REVISIÓN POR UN ABOGADO

> **Aviso.** Esta sección resume lo que se encontró en internet el 2026-10-31. **No es asesoría legal.** Cada punto trae su fuente y una marca de qué tan verificado está. Antes de vender ConfortVets a clientes reales, un abogado (idealmente con experiencia en protección de datos) y el Consejo/gremio veterinario deben revisarla, y revisar también los textos de autorizaciones y la política de datos que el sistema muestre.
>
> Marcas: **[Verificado]** = leído en el texto de la norma; **[Parcial]** = visto en fuentes secundarias o fragmentos; **[Sin verificar]** = viene de conocimiento general, no se confirmó en esta búsqueda.

### 13.1 Historia clínica veterinaria — Ley 576 de 2000 (Código de Ética)

Texto consultado: [Función Pública — Ley 576 de 2000](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=66201).

- **[Verificado]** Art. 61: la historia clínica es *"la consignación obligatoria por escrito de las condiciones de salud del animal objeto de atención"*.
- **[Verificado]** Art. 61 (final): esa información *"es privada, sometida a reserva"* y *"sólo puede ser conocida por terceros previa autorización de los propietarios del animal"*.
- **[Verificado]** Arts. 56 a 59: secreto profesional; el profesional responde por lo que revele y también por el personal auxiliar que maneja la información.
- **[Verificado]** Art. 26: no se interviene quirúrgicamente un animal *"sin la previa autorización del usuario o persona responsable"*, salvo urgencia.
- **[Verificado]** Art. 27: el profesional debe comunicar al usuario el tipo de tratamiento, los riesgos y efectos adversos. Art. 28: casos en que queda exonerado de informar (ausencia del responsable, urgencia, reacción inmediata e inesperada); en ellos *"se dejará constancia en la historia clínica"*.
- **[Verificado]** Art. 19, parágrafo 2: la eutanasia *"podrá realizarse con la voluntad y previa autorización del usuario de los servicios o responsable del animal"*; el método debe ser *"farmacológicamente aceptado, humanitario e indoloro"*.
- **[Verificado]** El texto **no fija un plazo de conservación** de las historias clínicas.
- **[Parcial]** Una tabla de retención documental de una entidad privada ([Colsubsidio](https://www.colsubsidio.com/hubfs/documentos/colsubsidio/trd-coordinacion-salud-animal.pdf)) asigna a las historias clínicas veterinarias 5 años en archivo de gestión y 15 en archivo central. Es un instrumento interno de esa entidad, **no una norma general**.
- **[Sin verificar]** Si otra norma (por ejemplo, de archivos o del Consejo Profesional) fija un plazo para historias clínicas veterinarias. Consultar al Consejo Profesional de Medicina Veterinaria y Zootecnia (COMVEZCOL) y a un abogado.

**Cómo lo refleja el diseño:**
- Las consultas cerradas no se borran (sección 8); las correcciones son notas aclaratorias o anulaciones con motivo.
- La historia queda disponible para exportación e impresión.
- El acceso de terceros requiere autorización del propietario: en la aplicación solo accede personal de la propia organización (RLS), y el super admin no ve datos clínicos.
- **Decisión pendiente (con el abogado):** qué pasa con los datos de una organización que deja de pagar o se retira (¿cuánto tiempo se conservan? ¿se le entrega copia?). Hasta definirlo, **no se borra nada automáticamente** y la organización vencida queda en solo lectura.

### 13.2 Datos personales — Ley 1581 de 2012 y decretos reglamentarios

El veterinario guarda datos personales de sus clientes (tutores): nombre, cédula, teléfono, dirección, barrio, correo. Aplica la Ley 1581 de 2012.

- **[Parcial]** Se necesita autorización previa, expresa e informada del titular (el tutor) para tratar sus datos; se regula en el Decreto 1377 de 2013 (compilado en el Decreto 1074 de 2015). Fuentes: [ejemplos de políticas y manuales](https://core.ac.uk/download/213559837.pdf), [SIC — consulta de titulares RNBD](https://rnbd.sic.gov.co/sisi/consultaTitulares/archivo/64eb80b3-c653-4d6f-9343-bab3b4e4a4f5).
- **[Parcial]** Quien trata datos debe adoptar un manual interno de políticas y procedimientos y atender consultas y reclamos de los titulares (acceso, corrección, supresión).
- **[Parcial]** Registro Nacional de Bases de Datos (RNBD): el Decreto 090 de 2018 limitó la obligación de inscribirse a sociedades y entidades sin ánimo de lucro con **activos totales superiores a 100.000 UVT**, y a personas jurídicas públicas. Las personas naturales y las sociedades por debajo de ese umbral quedaron excluidas. Fuente: [Actualícese — Decreto 090 de 2018](https://actualicese.com/archivo/decreto-090-de-18-01-2018/). **Verificar vigencia** en el sitio de la SIC (hay publicaciones recientes sobre cambios al RNBD).
- **[Sin verificar]** Roles: lo habitual es que el **veterinario sea el "responsable"** del tratamiento y **NovaStudio el "encargado"** (procesa datos por cuenta de él). Eso suele exigir un contrato o cláusulas de encargo, y deber de seguridad y confidencialidad. Confirmar con el abogado.
- **[Sin verificar]** **Dónde están los servidores.** Si Supabase aloja los datos fuera de Colombia, hay reglas sobre transferencia y transmisión internacional de datos. Revisar la región elegida del proyecto y la regla aplicable.
- **[Sin verificar]** Si los datos de salud del *animal* son datos personales: en principio no, porque la ley protege a personas; los datos del tutor sí lo son. Confirmar el criterio del abogado.

**Cómo lo refleja el diseño:**
- Campo de **consentimiento de tratamiento de datos** del tutor con fecha, y de **consentimiento de contacto** por WhatsApp, guardados en `tutors`.
- Plantilla editable de **política de tratamiento** y de autorización de datos (para que el veterinario la use con sus propios tutores).
- Funciones de **exportar y corregir** los datos de un tutor, y de **suprimirlos o anonimizarlos** cuando corresponda, respetando la historia clínica (que es obligatoria y no se borra). El equilibrio entre ambas obligaciones lo define el abogado.
- Bitácora de accesos y cambios, y datos solo de la propia organización por RLS.
- **Documentos legales propios de NovaStudio:** términos de servicio, política de privacidad y contrato de encargo de datos con cada veterinario. **Por redactar con el abogado.**

### 13.3 Firma electrónica de las autorizaciones — Ley 527 de 1999 y Decreto 2364 de 2012

- **[Parcial]** La **firma electrónica simple** está reglamentada por el Decreto 2364 de 2012 (que reglamenta el artículo 7 de la Ley 527 de 1999), compilado en el Decreto 1074 de 2015, artículos 2.2.2.47.1 y siguientes. Fuente: [Decreto 2364 de 2012](https://jurinfo.jep.gov.co/Normograma/Compilacion/docs/decreto_2364_2012.htm).
- **[Parcial]** La confiabilidad se mide por si el método identifica de forma fiable al firmante y es adecuado para la finalidad (art. 4 del decreto, compilado como 2.2.2.47.4). Salvo prueba en contrario, se presume que los mecanismos de identificación o autenticación usados son adecuados. Esta lectura viene de fragmentos y de [una página comercial](https://www.pandadoc.com/es/electronic-signature-law/colombia/) con interés propio: **verificar en el texto oficial**.
- **[Parcial]** La **firma digital** (con certificado de una entidad acreditada ante ONAC) es otra figura, más fuerte. La firma simple **no** requiere ese certificado. Ley 527 de 1999 y Decreto 1747 de 2000.
- **[Parcial]** Los mensajes de datos se presumen auténticos según el Código General del Proceso; las fuentes citan de forma distinta el artículo (243 o 244). **Verificar.**
- **[Sin verificar]** Qué tan sólida es la firma simple como prueba de una autorización de eutanasia o anestesia si el tutor la niega después.

**Cómo lo refleja el diseño** (evidencia que se guarda con cada autorización):
- Nombre y cédula del firmante, fecha y hora, IP, navegador, método (en pantalla o archivo subido).
- Copia congelada del texto firmado y su **hash** (huella) para demostrar que no cambió.
- Autorización firmada **inmodificable**.
- Para el futuro (no en la primera versión): verificación por código enviado al celular o correo del tutor, para reforzar la identidad.

### 13.4 Consentimientos y autorizaciones — qué exige la ética veterinaria

- **[Verificado]** Autorización previa del responsable para cirugía (art. 26), información de riesgos del tratamiento (art. 27) y autorización para la eutanasia (art. 19). Ver 13.1.
- **[Parcial]** Hay formatos de consentimiento informado de procedimientos médico-quirúrgicos y de hospitalización publicados por una universidad ([Unillanos — formato de consentimiento](https://sig.unillanos.edu.co/phocadownload/FO-GAA-134%20CONSENTIMIENTO%20INFORMADO%20PROCEDIMIENTOS%20MEDICO%20QUIRURGICOS%20VETERINARIOS_v04.docx)). Sirven de **modelo de contenido** (riesgos, posibilidad de retirar el consentimiento antes del procedimiento, anexar a la historia clínica). El texto final lo valida el abogado y el veterinario.
- **[Sin verificar]** No encontré una norma que exija un formato específico de autorización para vacunas ni anestesia; en esta búsqueda no apareció. Confirmar con el Consejo Profesional.

**Cómo lo refleja el diseño:** plantillas por tipo (vacuna, anestesia, procedimiento, eutanasia) editables por organización, con riesgos y retiro del consentimiento, y anexadas a la historia clínica del paciente.

### 13.5 Leyes de bienestar animal y servicios veterinarios (contexto)

- **[Parcial]** **Ley 2455 de 2025**: fortalece la lucha contra el maltrato animal y actualiza el Estatuto de Protección Animal (Ley 84 de 1989) y el Código Penal. No se encontró en ella requisitos de registro para clínicas. [Texto](https://sidn.ramajudicial.gov.co/SIDN//NORMATIVA/TEXTOS_COMPLETOS/7_LEYES/LEYES%202025/Ley%202455%20de%202025.pdf).
- **[Parcial]** **Ley 2480 de 2025 ("Ley Kiara")**: regula servicios de cuidado de animales de compañía y establece que los establecimientos que presten esos servicios se registren; prevé multas y clausuras. [Función Pública](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=260800). **No se pudo confirmar** el alcance exacto ni su reglamento. Es relevante sobre todo si ConfortVets agrega peluquería o guardería.
- **[Sin verificar]** Requisitos de habilitación de los establecimientos veterinarios (responsable técnico, instalaciones). Es obligación del cliente, no del software, pero conviene saberlo para no prometer lo que no corresponde.

### 13.6 Otros temas que no se pudieron verificar

- **[Sin verificar]** **Medicamentos de control especial** (por ejemplo ketamina, tramadol, fenobarbital): su fórmula suele requerir formatos y controles especiales fuera de un recetario común. Averiguar antes de ofrecer la "fórmula" como válida para ellos; la fórmula impresa del sistema podría limitarse a medicamentos sin control especial.
- **[Sin verificar]** **Certificado de salud para viaje o movilización** de animales: suele tener requisitos del ICA y de autoridades de destino. El certificado del sistema debe presentarse como **certificado simple del veterinario**, no como el documento oficial de movilización, salvo que se confirme lo contrario.
- **[Sin verificar]** **Firma y tarjeta profesional del veterinario en la fórmula:** confirmar qué datos debe llevar una fórmula veterinaria válida.
- **[Sin verificar]** **Facturación electrónica** (DIAN) para el módulo de inventario y caja de la versión 2.
- **[Sin verificar]** **Condiciones de venta como software** (términos de servicio, responsabilidad, SLA, propiedad de los datos).

### 13.7 Lista de revisión para el abogado

1. Plazo de conservación y entrega de historias clínicas (13.1), y qué hacer cuando la organización se va o deja de pagar.
2. Política de tratamiento de datos y autorización del tutor: texto definitivo (13.2).
3. Roles responsable/encargado entre el veterinario y NovaStudio, y contrato de encargo (13.2).
4. Transferencia internacional de datos según la región de Supabase (13.2).
5. Obligación de RNBD para NovaStudio y para sus clientes (13.2).
6. Valor probatorio de la firma electrónica simple en autorizaciones de alto riesgo (13.3).
7. Textos de las cuatro autorizaciones (vacuna, anestesia, procedimiento, eutanasia) (13.4).
8. Alcance de la Ley 2480 de 2025 si se agrega peluquería o guardería (13.5).
9. Medicamentos de control especial y certificados (13.6).
10. Términos de servicio y política de privacidad de ConfortVets (13.6).

Mientras esta lista no se haya revisado, **ConfortVets no debe ofrecerse a clientes que guarden información real.** Puede usarse para desarrollo y demostraciones con datos de prueba.

---

## 14. Estado de la implementación (versión 1)

### Construido

| Fase | Contenido | Estado |
|---|---|---|
| 0. Base | Proyecto Next.js 16, pantalla de inicio con marca de ConfortVets, pie «Desarrollado por NovaStudio» (WhatsApp), `netlify.toml`, CI | Hecho |
| 1. Núcleo | Login por usuario con bloqueo tras intentos fallidos, organizaciones, módulos, permisos, auxiliares, cambio de contraseña sin saber la anterior, desactivación, vencimiento (solo lectura), bitácora, marca por organización, respaldo cifrado semanal | Hecho |
| 2. Tutores y pacientes | Altas, edición, búsqueda, catálogos de especies y razas, foto, microchip, alergias, campos personalizados, curva de peso, anonimización de tutor | Hecho |
| 3. Historia clínica | Consulta y control, signos vitales, exámenes en PDF, fórmula imprimible, cierre, anulación, notas aclaratorias, plantillas de texto | Hecho |
| 4. Preventivo | Vacunas, desparasitación, catálogos, reglas, mensajes, pantalla de recordatorios con WhatsApp, carné imprimible | Hecho |
| 5. Autorizaciones | Plantillas por tipo, llenado automático, firma en pantalla o documento subido, copia congelada, huella verificable | Hecho |
| 6. Cierre | Certificado de salud, exportación (Excel y JSON), pruebas, README | Hecho |

### Verificado automáticamente

- **Base de datos (`npm run test:db`):** 108 comprobaciones contra un PostgreSQL real: aislamiento entre organizaciones, claves compuestas, módulos, permisos de auxiliares, restricciones del super admin, super admin sin acceso a datos clínicos, membresía vencida (solo lectura), organización inactiva, imposibilidad de escalar privilegios, ciclo borrador → cerrada → anulada, notas aclaratorias, recordatorios automáticos, huella de las autorizaciones, cuota de almacenamiento, límites de usuarios, bitácora inmutable, e inmutabilidad incluso con la llave de servicio.
- **Lógica (`npm test`):** 40 pruebas (contraseñas, fechas, edades, membresía, WhatsApp, plantillas, cuota, campos personalizados, permisos —incluye una prueba que compara el catálogo del código con el de la base de datos— y cifrado del respaldo).
- **`npm run lint`, `npm run typecheck`, `npm run build`:** sin errores.
- **Prueba de humo del servidor:** `/login` carga con el formulario en el HTML, `/dashboard` sin sesión redirige, `/api/*` sin sesión responde 401, encabezados de seguridad presentes.

### NO verificado todavía (hazlo con tu proyecto de Supabase real)

1. **El recorrido completo con sesión** (iniciar sesión, crear tutor, consulta, firma, subir archivos). Las consultas de la aplicación usan PostgREST de Supabase y no se ejecutaron contra uno real. Sigue la lista de verificación del README.
2. **Subida de archivos** a Supabase Storage y las URL firmadas.
3. **El despliegue en Netlify** (compatibilidad de Next.js 16 y de `sharp` en funciones). Verifícalo antes de depender de él.
4. **Revisión visual** de las pantallas autenticadas en celular y escritorio (solo se revisó la de inicio de sesión).

### Decisiones y límites conocidos

- Sin ambiente de pruebas separado hasta pasar a Pro (solo hay 2 proyectos gratis de Supabase).
- Recordatorios solo por WhatsApp manual (un clic por mensaje). No hay envío automático.
- La fórmula es un documento simple: **no** sirve para medicamentos de control especial (sección 13.6).
- El certificado es un certificado simple del veterinario, no un documento oficial de movilización.
- Un paciente tiene un tutor. Agenda, inventario/caja, hospitalización y portal del tutor quedan para las versiones 2 y 3 (los módulos ya existen en el catálogo, apagados).
- No hay CSP (Content-Security-Policy) configurada; sí hay las demás cabeceras de seguridad.
- El respaldo exporta los datos de la aplicación, no las contraseñas (Supabase Auth) ni los archivos (Storage).
- Las contraseñas temporales se muestran en pantalla a quien las crea (el administrador o el super admin) para que las entregue; el usuario debe cambiarla al ingresar.
- **Los textos de autorizaciones, la política de datos y todo lo de la sección 13 son de ejemplo y deben ser revisados por un abogado antes de usar el sistema con clientes reales.**

### Ajustes tras la primera prueba real (2026-11-02)

- **Tutor:** solo el nombre es obligatorio. Si faltan cédula, teléfono/WhatsApp, dirección o barrio se muestra un aviso informativo que no bloquea el guardado.
- **Autorización de datos:** al crear un tutor se pasa a un paso obligatorio (`/dashboard/tutores/[id]/autorizacion`): firma en pantalla **o** "ya firmó en físico" (copia opcional). Sin resolverla no se registran pacientes (si el módulo de autorizaciones está activo). Un solo consentimiento de datos por tutor, que cubre a todas sus mascotas.
- **Autorizaciones de procedimiento:** cada una guarda su propia firma, ligada a su paciente y procedimiento; nunca se reutiliza.
- **Firma en físico sin archivo** (`signature_method = 'fisico'`, migración `20261102000100_consent_physical.sql`): evidencia más débil que la firma en pantalla o el documento adjunto; queda anotado en la autorización.

### Módulo Agenda (2026-11-02)

Migración `20261102000200_agenda.sql`. Se activa por organización desde el super admin (módulo `agenda`).

- **Datos:** `appointments` (citas), `appointment_types` (tipo, duración y color), `agenda_hours` (franjas por día, varias por día), `agenda_blocks` (festivos, vacaciones), `agenda_settings` (tamaño del espacio, permitir cruces, mensaje de recordatorio) y `agenda_waitlist` (lista de espera). Todo editable por el veterinario en Configuración → Agenda.
- **Reglas en la base de datos** (`appointments_guard`): sin cruces de citas activas (salvo que la organización lo permita), sin citas en periodos bloqueados, el tutor se toma del paciente, estados con transiciones válidas (programada → confirmada → en sala → atendida; cancelada y no asistió son finales) y las citas no se borran.
- **Horario de atención:** si una cita queda fuera de él, la aplicación avisa y deja agendarla solo si se marca «de todos modos». Los horarios se guardan como hora local del consultorio.
- **Flujo:** agenda por día y por semana; los espacios libres se agendan con un clic; «Atender» abre una consulta en borrador con el motivo de la cita y marca la cita atendida; recordatorio por WhatsApp (enlace `wa.me`, manual) y lista de las citas de mañana por recordar; la ficha del paciente muestra su próxima cita.
- **Permisos:** `agenda.read` y `agenda.write`; el horario, los bloqueos y los tipos usan `settings.write`.
- **No incluido (futuro):** recordatorio automático sin intervención (requiere la API de WhatsApp Business), sincronización con Google Calendar y agenda por profesional.

### Módulos bloqueados en el menú (2026-11-02)

El menú del consultorio muestra, bajo «Más módulos», los módulos que no tiene activos, con un candado. Al pasar el mouse dice «¿Quieres adquirir este módulo?»; al dar clic abre un diálogo y, si acepta, lleva al WhatsApp de NovaStudio con un mensaje que incluye el nombre del consultorio (y del profesional) y el módulo. Los que aún no están construidos lo indican. La lista sale de la tabla `modules`, así que un módulo nuevo aparece solo.

### Propuesta: Inventario y caja (PENDIENTE de ok, no construido)

**Principios acordados:** las existencias se **suman** a lo que ya existe (una entrada nunca reemplaza la cantidad); la facturación es **interna** pero el modelo queda **listo para la DIAN** más adelante sin migrar ventas.

**Inventario**
- Productos (medicamento, insumo, alimento/accesorio, servicio) con unidad, costo, precio, % de IVA, existencia mínima y, opcional por producto, control de **lote y vencimiento**.
- Libro de movimientos que solo se agrega (entrada, salida, ajuste, merma, uso en consulta, venta). La existencia es la suma de los movimientos; no se edita a mano, se corrige con un ajuste con motivo.
- **Agregar existencias:** se elige el producto que ya existe y la cantidad, y se suma. Compras a proveedor con varios productos, costo promedio ponderado y número de factura del proveedor.
- Alertas de stock bajo y de próximos a vencer (primero en vencer, primero en salir).
- Descuento desde la consulta: al cerrar una fórmula se ofrece descontar del inventario lo recetado.

**Ventas y caja (internas)**
- Venta con consecutivo por organización y serie, cliente (tutor, opcional), líneas con precio, descuento e IVA, y pagos mixtos (efectivo, transferencia, tarjeta, billeteras). Una venta no se edita ni se borra: se anula con motivo y se revierte el inventario.
- Caja: apertura y cierre con arqueo (esperado vs contado y diferencia), ingresos y egresos de caja.
- Recibo imprimible rotulado «Documento interno, no es factura electrónica».

**Listo para la DIAN (sin implementarla):** series de numeración con tabla de rangos (resolución, desde, hasta, vigencia), datos fiscales del cliente (tipo y número de documento, correo, dirección), impuestos por línea (base y tarifa), tipo de documento (`interno` hoy; `factura_electronica` y `nota_credito` después) y campos vacíos para la respuesta del proveedor tecnológico (CUFE, estado). La anulación de hoy pasará a ser nota crédito. Conectar a un proveedor (Alegra, Siigo, Factus, etc.) será un módulo aparte.

**Permisos propuestos:** `inventory.read`, `inventory.write` (movimientos y compras), `inventory.manage` (catálogo, costos y precios), `sales.write`, `cash.manage` (abrir/cerrar caja y anular).

### Inventario y caja — construido (2026-11-02)

Migración `20261102000300_inventory.sql`. Se activa por organización desde el super admin (módulo `inventory`). Decisiones: costo promedio ponderado, IVA por producto (precio con IVA incluido), ventas a crédito con abonos y una sola caja abierta por consultorio.

- **Existencias:** una entrada SUMA a lo que ya hay. La existencia y el costo promedio solo cambian por movimientos (`stock_movements`, solo se agregan). Un ajuste o merma exige motivo. Las existencias no quedan en negativo (se puede permitir en Ajustes, solo para productos sin lote). El costo promedio no se revierte al anular una compra: se recalcula con las siguientes entradas.
- **Lotes:** opcional por producto. Las salidas toman primero el lote que vence antes. Avisos de stock bajo y de vencimiento.
- **Compras:** a proveedor, con varios productos; se anulan con motivo (si ya se vendió parte, no se puede).
- **Ventas internas:** consecutivo por serie (`V-0001`), líneas con IVA por línea, descuento, pagos mixtos y saldo a crédito con abonos. No se editan ni se borran: se anulan con motivo, se devuelve el inventario a los mismos lotes y se registra la devolución en la caja abierta.
- **Caja:** apertura, ingresos, egresos, cierre con arqueo (esperado vs contado). Una sola abierta a la vez.
- **Consulta:** «Descontar inventario» (sugiere lo recetado) y «Cobrar».
- **Seguridad:** las operaciones que tocan varias tablas son funciones (`sale_create`, `inv_add_stock`, `cash_close`...) que revisan permiso y membresía en una sola transacción; los usuarios no escriben esas tablas directamente. Permisos: `inventory.read/write/manage`, `sales.read/write`, `cash.manage`. Quien vende necesita ver los productos (`sales.write` basta).
- **Listo para la DIAN (no implementada):** `document_series` (prefijo, resolución, rango, vigencia), datos fiscales del cliente, base e IVA por línea, `doc_type` (`interno` hoy) y campos reservados `einvoice_*`. La factura electrónica se conectará con un proveedor tecnológico como módulo aparte, y la anulación pasará a ser nota crédito.

### Corrección de historias cerradas por el administrador (2026-11-02)

Migración `20261102000400_consultation_admin_edit.sql`. Una consulta cerrada sigue siendo inmutable para todos salvo el administrador (owner), que usa «Corregir (administrador)»: exige un motivo, cambia solo el contenido clínico (no el paciente, la fecha, el profesional ni el estado), guarda la versión anterior en `consultation_revisions` (solo se agrega) y deja el contador `edit_count`. La consulta muestra «Corregida n veces» y su historial de correcciones. Si cambia la fecha del próximo control, su recordatorio la sigue. No incluye la fórmula médica (queda congelada) ni los archivos de exámenes.
