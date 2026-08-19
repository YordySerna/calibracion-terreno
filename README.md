# Calibración Forestal (terreno)

App instalable (PWA) para calibrar en terreno desde el celular, Android o
iPhone. Funciona sin señal una vez instalada.

**App en línea:** https://yordyserna.github.io/calibracion-terreno/

## Qué hace

- **Cubicación JAS**: conteo de trozos por clase diamétrica (16–80 cm) y largo
  (2,50 / 3,20 / 4,00 / 5,00 / 6,00 / 7,00 / 8,00 m nominal), con el volumen
  calculado por la norma JAS. Reproduce la tabla de cubicación de terreno.
- **Metro ruma**: la ruma se mide por su cara (MR = largo × alto promedio).
  Volumen estéreo = MR × largo del trozo; sólido = estéreo × factor de
  apilamiento.
- **Reporte diario**: fecha, faena, máquina, operador, producción del día y un
  recuadro de novedades (panas, detenciones, clima…) para informar a los jefes.
- **Historial**: cada día guardado queda en el teléfono y se puede volver a
  exportar.
- **Exportar a Excel**: genera un `.xlsx` real (hojas Reporte, Cubicación JAS y
  Metro ruma) sin ninguna librería externa, y se puede compartir directo por
  WhatsApp. También exporta un resumen de todo el historial.

## Instalación en el teléfono

1. Abrir https://yordyserna.github.io/calibracion-terreno/ en el navegador.
2. **Android (Chrome):** menú ⋮ → «Agregar a pantalla de inicio» / «Instalar app».
3. **iPhone (Safari):** botón compartir → «Agregar a pantalla de inicio».

Queda con su ícono como una app más y funciona sin conexión.

## Fórmulas

- JAS, largos bajo 6 m: `V = D² × L ÷ 10.000`
- JAS, largos de 6 m o más: `V = (D + (L′ − 4) ÷ 2)² × L ÷ 10.000`
  (L′ = largo nominal sin decimales)
- Metro ruma: `MR = largo de la ruma × alto promedio` ·
  `m³ estéreo = MR × largo del trozo` ·
  `m³ sólido = estéreo × factor de apilamiento`

## Desarrollo

HTML, CSS y JavaScript clásico. Sin build, sin npm, sin frameworks. El
generador de Excel (`js/xlsx.js`) arma el ZIP y los XML del formato a mano.

Los datos se guardan en el `localStorage` del dispositivo; no se sube nada a
ningún servidor.
