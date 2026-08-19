# Calibración Forestal (terreno) — notas del proyecto

PWA de calibración forestal: cubicación JAS + metro ruma + reporte diario +
historial con export a `.xlsx`. Repo: `calibracion-terreno`, publicado en
GitHub Pages: https://yordyserna.github.io/calibracion-terreno/

## Relación con el repo `calibracion-forestal`

Existe una suite anterior (6 herramientas, julio 2026) en el repo
`calibracion-forestal`. **No pisarla.** Esta app es más simple y enfocada en el
flujo diario: contar, registrar rumas, informar. El método MR se tomó de la
decisión documentada allá:

- MR = largo de la ruma × alto promedio (la cara, no un volumen)
- m³ estéreo = MR × largo del trozo
- m³ sólido = estéreo × factor de apilamiento

## Decisiones

- La fórmula JAS viene de la tabla Excel del usuario (validada celda por
  celda): bajo 6 m `D²·L/10000`; desde 6 m `(D+(⌊L⌋−4)/2)²·L/10000`.
- Largos de la tabla de terreno: nominal 2,5/3,2/4/5/6/7/8 (los reales con
  sobredimensión son 2,5/3,3/4,1/5,1/6,1/7,1/8,1 pero el volumen usa el
  nominal, igual que el Excel original).
- Clases diamétricas 16–80 cm de 2 en 2, igual que la tabla.
- `js/xlsx.js` genera el .xlsx a mano (ZIP sin compresión + XML con
  inlineStr). Validado con openpyxl. Sin librerías.
- Todo el estado en `localStorage` (`calibracionForestal_v1`).
- **Al cambiar cualquier archivo hay que subir la VERSION en `sw.js`**, si no
  los teléfonos siguen usando el caché viejo.

## Desarrollo local

Servidor: el `serve.ps1` del portafolio (HttpListener) apuntando a esta
carpeta. El SW solo se registra bajo http/https, no en `file://`.
