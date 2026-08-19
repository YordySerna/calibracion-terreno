/* Calibración Forestal — lógica de la app.
   Cubicación JAS + metro ruma + reporte diario + historial con export a Excel. */
(function () {
  'use strict';

  /* ================= Norma JAS ================= */

  // Largos de la tabla de terreno: nominal (para el volumen) y real (con sobredimensión).
  var LARGOS = [
    { nom: 2.5, real: 2.5 },
    { nom: 3.2, real: 3.3 },
    { nom: 4.0, real: 4.1 },
    { nom: 5.0, real: 5.1 },
    { nom: 6.0, real: 6.1 },
    { nom: 7.0, real: 7.1 },
    { nom: 8.0, real: 8.1 }
  ];

  // Clases diamétricas de la tabla: 16 a 80 cm, de 2 en 2.
  var DIAMETROS = [];
  for (var d = 16; d <= 80; d += 2) DIAMETROS.push(d);

  // Volumen JAS de un trozo. d en cm, largo nominal en m.
  function volumenJAS(d, largo) {
    if (!(d > 0) || !(largo > 0)) return 0;
    if (largo < 6) return d * d * largo / 10000;
    var ajustado = d + (Math.floor(largo) - 4) / 2;
    return ajustado * ajustado * largo / 10000;
  }

  /* ================= Estado y persistencia ================= */

  var CLAVE = 'calibracionForestal_v1';

  function estadoNuevo() {
    return {
      actual: {
        fecha: hoyISO(),
        faena: '',
        maquina: '',
        operador: '',
        novedades: '',
        conteo: {},        // { "3.2": { "18": 46, ... }, ... }
        rumas: [],         // [ { largo, altos:[...], trozo } ]
        factorMR: ''
      },
      historial: []
    };
  }

  function cargar() {
    try {
      var crudo = localStorage.getItem(CLAVE);
      if (!crudo) return null;
      var e = JSON.parse(crudo);
      if (!e || !e.actual) return null;
      return e;
    } catch (err) {
      return null;
    }
  }

  function guardar() {
    try {
      localStorage.setItem(CLAVE, JSON.stringify(estado));
    } catch (err) {
      // Sin espacio o modo privado: la app sigue funcionando, solo no persiste.
    }
  }

  var estado = cargar() || estadoNuevo();
  var largoActivo = 0; // índice en LARGOS

  function hoyISO() {
    var f = new Date();
    return f.getFullYear() + '-' +
      String(f.getMonth() + 1).padStart(2, '0') + '-' +
      String(f.getDate()).padStart(2, '0');
  }

  /* ================= Utilidades ================= */

  function $(id) { return document.getElementById(id); }

  function fmt(n, dec) {
    return Number(n).toLocaleString('es-CL', {
      minimumFractionDigits: dec, maximumFractionDigits: dec
    });
  }

  function fmtLargo(l) { return fmt(l, 2); }

  function numeroDesdeTexto(t) {
    if (t === null || t === undefined) return NaN;
    return parseFloat(String(t).trim().replace(',', '.'));
  }

  function fechaLegible(iso) {
    if (!iso) return '';
    var partes = iso.split('-');
    if (partes.length !== 3) return iso;
    var f = new Date(+partes[0], +partes[1] - 1, +partes[2]);
    return f.toLocaleDateString('es-CL', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
  }

  /* ================= Totales ================= */

  function totalesLargo(conteo, indiceLargo) {
    var L = LARGOS[indiceLargo];
    var porDiam = conteo[String(L.nom)] || {};
    var n = 0, m3 = 0;
    for (var i = 0; i < DIAMETROS.length; i++) {
      var cant = porDiam[String(DIAMETROS[i])] || 0;
      n += cant;
      m3 += cant * volumenJAS(DIAMETROS[i], L.nom);
    }
    return { n: n, m3: m3 };
  }

  function totalesConteo(conteo) {
    var n = 0, m3 = 0;
    for (var i = 0; i < LARGOS.length; i++) {
      var t = totalesLargo(conteo, i);
      n += t.n;
      m3 += t.m3;
    }
    return { n: n, m3: m3 };
  }

  // Método MR: la ruma se mide por su cara (largo × alto promedio).
  // El volumen estéreo = MR × largo del trozo; el sólido = estéreo × factor de apilamiento.
  function altoPromedio(r) {
    var suma = 0;
    for (var i = 0; i < r.altos.length; i++) suma += r.altos[i];
    return r.altos.length ? suma / r.altos.length : 0;
  }

  function mrDeRuma(r) {
    return r.largo * altoPromedio(r);
  }

  function estereoDeRuma(r) {
    return mrDeRuma(r) * r.trozo;
  }

  function totalMR(rumas) {
    var t = 0;
    for (var i = 0; i < rumas.length; i++) t += mrDeRuma(rumas[i]);
    return t;
  }

  function totalEstereo(rumas) {
    var t = 0;
    for (var i = 0; i < rumas.length; i++) t += estereoDeRuma(rumas[i]);
    return t;
  }

  function resumenDe(datos) {
    var tc = totalesConteo(datos.conteo);
    return {
      trozos: tc.n,
      m3: tc.m3,
      rumas: datos.rumas.length,
      mr: totalMR(datos.rumas),
      est: totalEstereo(datos.rumas)
    };
  }

  /* ================= Pestañas ================= */

  var botonesTab = document.querySelectorAll('.tabs button');
  for (var bi = 0; bi < botonesTab.length; bi++) {
    botonesTab[bi].addEventListener('click', function () {
      var destino = this.getAttribute('data-panel');
      var i;
      for (i = 0; i < botonesTab.length; i++) botonesTab[i].classList.remove('activa');
      this.classList.add('activa');
      var paneles = document.querySelectorAll('.panel');
      for (i = 0; i < paneles.length; i++) paneles[i].classList.remove('activa');
      $('panel-' + destino).classList.add('activa');
      if (destino === 'reporte') pintarProduccion();
      if (destino === 'historial') pintarHistorial();
      window.scrollTo(0, 0);
    });
  }

  /* ================= Calculadora rápida ================= */

  function calcularRapida() {
    var d = numeroDesdeTexto($('calcDiam').value);
    var l = numeroDesdeTexto($('calcLargo').value);
    if (!(d > 0) || !(l > 0)) {
      $('calcRes').textContent = 'Ingresa diámetro y largo';
      return;
    }
    var v = volumenJAS(d, l);
    $('calcRes').textContent = 'V = ' + fmt(Math.round(v * 1000) / 1000, 3) + ' m³';
  }
  $('calcDiam').addEventListener('input', calcularRapida);
  $('calcLargo').addEventListener('input', calcularRapida);

  /* ================= Conteo JAS ================= */

  function pintarChips() {
    var html = '';
    for (var i = 0; i < LARGOS.length; i++) {
      var L = LARGOS[i];
      var t = totalesLargo(estado.actual.conteo, i);
      html += '<button type="button" data-indice="' + i + '"' +
        (i === largoActivo ? ' class="activa"' : '') + '>' +
        fmtLargo(L.nom) + ' m' +
        '<small>' + (t.n ? t.n + ' trozos' : 'real ' + fmtLargo(L.real)) + '</small>' +
        '</button>';
    }
    $('chipsLargo').innerHTML = html;
  }

  $('chipsLargo').addEventListener('click', function (ev) {
    var btn = ev.target.closest('button');
    if (!btn) return;
    largoActivo = +btn.getAttribute('data-indice');
    pintarChips();
    pintarGrid();
  });

  function pintarGrid() {
    var L = LARGOS[largoActivo];
    var porDiam = estado.actual.conteo[String(L.nom)] || {};
    var html = '';
    for (var i = 0; i < DIAMETROS.length; i++) {
      var diam = DIAMETROS[i];
      var cant = porDiam[String(diam)] || 0;
      var m3 = cant * volumenJAS(diam, L.nom);
      html += '<div class="fila-diam' + (cant ? ' con-trozos' : '') + '" data-diam="' + diam + '">' +
        '<span class="diam">' + diam + '</span>' +
        '<button type="button" class="menos" aria-label="Quitar trozo de ' + diam + ' cm">−</button>' +
        '<input class="cuenta" type="number" inputmode="numeric" min="0" step="1" value="' + cant + '" aria-label="Trozos de ' + diam + ' cm">' +
        '<button type="button" class="mas" aria-label="Sumar trozo de ' + diam + ' cm">+</button>' +
        '<span class="m3">' + (cant ? fmt(m3, 3) : '') + '</span>' +
        '</div>';
    }
    $('gridConteo').innerHTML = html;
    pintarResumen();
  }

  // Fija la cantidad de una clase diamétrica y actualiza solo la fila tocada
  // y los resúmenes. escribirCampo=false cuando el cambio viene del propio
  // input, para no pisar lo que el usuario está tipeando.
  function fijarCuenta(fila, cant, escribirCampo) {
    var diam = fila.getAttribute('data-diam');
    var L = LARGOS[largoActivo];
    var claveLargo = String(L.nom);
    if (!estado.actual.conteo[claveLargo]) estado.actual.conteo[claveLargo] = {};
    var porDiam = estado.actual.conteo[claveLargo];
    if (!(cant > 0)) { cant = 0; delete porDiam[diam]; }
    else porDiam[diam] = cant;
    guardar();

    var m3 = cant * volumenJAS(+diam, L.nom);
    if (escribirCampo) fila.querySelector('.cuenta').value = cant;
    fila.querySelector('.m3').textContent = cant ? fmt(m3, 3) : '';
    fila.classList.toggle('con-trozos', cant > 0);
    pintarChips();
    pintarResumen();
  }

  function cuentaDe(fila) {
    var L = LARGOS[largoActivo];
    var porDiam = estado.actual.conteo[String(L.nom)] || {};
    return porDiam[fila.getAttribute('data-diam')] || 0;
  }

  $('gridConteo').addEventListener('click', function (ev) {
    var btn = ev.target.closest('button');
    if (!btn) return;
    var fila = btn.closest('.fila-diam');
    var cant = cuentaDe(fila) + (btn.classList.contains('mas') ? 1 : -1);
    fijarCuenta(fila, cant, true);
  });

  // Tipear la cantidad directo en el campo (para no apretar + trescientas veces).
  $('gridConteo').addEventListener('input', function (ev) {
    if (!ev.target.classList.contains('cuenta')) return;
    var n = parseInt(ev.target.value, 10);
    if (!(n >= 0)) n = 0;
    if (n > 99999) n = 99999;
    fijarCuenta(ev.target.closest('.fila-diam'), n, false);
  });

  // Al salir del campo se normaliza lo que quedó escrito (vacío → 0).
  $('gridConteo').addEventListener('change', function (ev) {
    if (!ev.target.classList.contains('cuenta')) return;
    ev.target.value = cuentaDe(ev.target.closest('.fila-diam'));
  });

  function pintarResumen() {
    var html = '<tr><th>Largo</th><th>Trozos</th><th>M³ JAS</th></tr>';
    var hayAlgo = false;
    for (var i = 0; i < LARGOS.length; i++) {
      var t = totalesLargo(estado.actual.conteo, i);
      if (!t.n) continue;
      hayAlgo = true;
      html += '<tr><td>' + fmtLargo(LARGOS[i].nom) + ' m</td>' +
        '<td>' + t.n + '</td><td>' + fmt(t.m3, 3) + '</td></tr>';
    }
    var total = totalesConteo(estado.actual.conteo);
    if (!hayAlgo) {
      html += '<tr><td colspan="3" class="vacio">Aún no hay trozos contados</td></tr>';
    }
    html += '<tr class="total"><td>TOTAL</td><td>' + total.n + '</td>' +
      '<td>' + fmt(total.m3, 3) + '</td></tr>';
    $('tablaResumen').innerHTML = html;
  }

  $('btnVaciarConteo').addEventListener('click', function () {
    if (!confirm('¿Vaciar todo el conteo de trozos? Esto no borra lo ya guardado en el historial.')) return;
    estado.actual.conteo = {};
    guardar();
    pintarChips();
    pintarGrid();
  });

  /* ================= Metro ruma ================= */

  $('btnAgregarRuma').addEventListener('click', function () {
    var largo = numeroDesdeTexto($('mrLargo').value);
    var trozo = numeroDesdeTexto($('mrTrozo').value);
    var textoAltos = $('mrAltos').value.trim();
    var altos = [];
    if (textoAltos) {
      var pedazos = textoAltos.split(/[\s;]+/);
      for (var i = 0; i < pedazos.length; i++) {
        var a = numeroDesdeTexto(pedazos[i]);
        if (a > 0) altos.push(a);
      }
    }
    if (!(largo > 0)) { alert('Falta el largo de la ruma.'); return; }
    if (!altos.length) { alert('Falta al menos un alto medido.'); return; }
    if (!(trozo > 0)) { alert('Falta el largo del trozo.'); return; }

    estado.actual.rumas.push({ largo: largo, altos: altos, trozo: trozo });
    guardar();
    $('mrLargo').value = '';
    $('mrAltos').value = '';
    pintarRumas();
  });

  $('factorMR').addEventListener('input', function () {
    estado.actual.factorMR = this.value;
    guardar();
    pintarConversionMR();
  });

  function pintarRumas() {
    var rumas = estado.actual.rumas;
    var html = '<tr><th>N°</th><th>Largo</th><th>Alto prom.</th><th>MR</th><th>M³ est.</th><th></th></tr>';
    for (var i = 0; i < rumas.length; i++) {
      var r = rumas[i];
      html += '<tr><td>' + (i + 1) + '</td>' +
        '<td>' + fmt(r.largo, 2) + '</td>' +
        '<td>' + fmt(altoPromedio(r), 2) + '</td>' +
        '<td>' + fmt(mrDeRuma(r), 2) + '</td>' +
        '<td>' + fmt(estereoDeRuma(r), 2) + '</td>' +
        '<td><button type="button" class="btn-mini" data-indice="' + i + '">✕</button></td></tr>';
    }
    if (!rumas.length) {
      html += '<tr><td colspan="6" class="vacio">Aún no hay rumas</td></tr>';
    }
    $('tablaRumas').innerHTML = html;
    $('totalMR').textContent = rumas.length
      ? 'Total: ' + fmt(totalMR(rumas), 2) + ' MR · ' + fmt(totalEstereo(rumas), 2) + ' m³ estéreo (' +
        rumas.length + (rumas.length === 1 ? ' ruma)' : ' rumas)')
      : 'Sin rumas registradas';
    pintarConversionMR();
  }

  function pintarConversionMR() {
    var factor = numeroDesdeTexto(estado.actual.factorMR);
    var est = totalEstereo(estado.actual.rumas);
    $('mrConvertido').textContent = (factor > 0 && est > 0)
      ? 'Volumen sólido: ' + fmt(est * factor, 3) + ' m³ (factor de apilamiento ' + fmt(factor, 2) + ')'
      : '';
  }

  $('tablaRumas').addEventListener('click', function (ev) {
    var btn = ev.target.closest('.btn-mini');
    if (!btn) return;
    var i = +btn.getAttribute('data-indice');
    if (!confirm('¿Eliminar la ruma N° ' + (i + 1) + '?')) return;
    estado.actual.rumas.splice(i, 1);
    guardar();
    pintarRumas();
  });

  /* ================= Reporte diario ================= */

  var camposReporte = { repFecha: 'fecha', repFaena: 'faena', repMaquina: 'maquina', repOperador: 'operador', repNovedades: 'novedades' };
  Object.keys(camposReporte).forEach(function (id) {
    $(id).addEventListener('input', function () {
      estado.actual[camposReporte[id]] = this.value;
      guardar();
    });
  });

  function pintarReporte() {
    $('repFecha').value = estado.actual.fecha;
    $('repFaena').value = estado.actual.faena;
    $('repMaquina').value = estado.actual.maquina;
    $('repOperador').value = estado.actual.operador;
    $('repNovedades').value = estado.actual.novedades;
    pintarProduccion();
  }

  function pintarProduccion() {
    var r = resumenDe(estado.actual);
    var html =
      '<tr><td>Trozos cubicados (JAS)</td><td>' + r.trozos + '</td></tr>' +
      '<tr><td>Volumen JAS</td><td>' + fmt(r.m3, 3) + ' m³</td></tr>' +
      '<tr><td>Rumas</td><td>' + r.rumas + '</td></tr>' +
      '<tr><td>Metro ruma</td><td>' + fmt(r.mr, 2) + ' MR</td></tr>' +
      '<tr><td>Volumen estéreo</td><td>' + fmt(r.est || 0, 2) + ' m³ est.</td></tr>';
    var factor = numeroDesdeTexto(estado.actual.factorMR);
    if (factor > 0 && r.est > 0) {
      html += '<tr><td>Volumen sólido (factor ' + fmt(factor, 2) + ')</td><td>' +
        fmt(r.est * factor, 3) + ' m³</td></tr>';
    }
    $('tablaProduccion').innerHTML = html;
  }

  $('btnGuardarDia').addEventListener('click', function () {
    var r = resumenDe(estado.actual);
    if (!r.trozos && !r.rumas && !estado.actual.novedades.trim()) {
      alert('No hay nada que guardar todavía: cuenta trozos, registra rumas o escribe las novedades.');
      return;
    }
    var copia = JSON.parse(JSON.stringify(estado.actual));
    copia.id = Date.now();
    copia.guardadoEl = new Date().toISOString();
    copia.tot = r;
    estado.historial.unshift(copia);

    var limpiar = confirm('Calibración guardada en el historial ✔\n\n¿Quieres limpiar el conteo, las rumas y las novedades para empezar una nueva?');
    if (limpiar) {
      estado.actual.conteo = {};
      estado.actual.rumas = [];
      estado.actual.novedades = '';
      estado.actual.fecha = hoyISO();
      pintarChips();
      pintarGrid();
      pintarRumas();
      pintarReporte();
    }
    guardar();
    pintarHistorial();
  });

  /* ================= Exportar a Excel ================= */

  function nombreArchivo(datos) {
    var base = 'calibracion_' + (datos.fecha || hoyISO());
    if (datos.maquina) {
      base += '_' + datos.maquina.trim().toLowerCase()
        .replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e').replace(/[íìï]/g, 'i')
        .replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u').replace(/ñ/g, 'n')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 30);
    }
    return base + '.xlsx';
  }

  function hojasDe(datos) {
    var r = datos.tot || resumenDe(datos);
    var i, j;

    // --- Hoja Reporte ---
    var filasReporte = [
      [{ v: 'REPORTE DIARIO DE CALIBRACIÓN FORESTAL', s: 1 }],
      [],
      [{ v: 'Fecha', s: 1 }, datos.fecha || ''],
      [{ v: 'Faena / Predio', s: 1 }, datos.faena || ''],
      [{ v: 'Máquina', s: 1 }, datos.maquina || ''],
      [{ v: 'Operador', s: 1 }, datos.operador || ''],
      [],
      [{ v: 'PRODUCCIÓN DEL DÍA', s: 1 }],
      [{ v: 'Trozos cubicados (JAS)', s: 0 }, r.trozos],
      [{ v: 'Volumen JAS (m³)', s: 0 }, { v: r.m3, s: 2 }],
      [{ v: 'Rumas registradas', s: 0 }, r.rumas],
      [{ v: 'Metro ruma (MR)', s: 0 }, { v: r.mr, s: 2 }],
      [{ v: 'Volumen estéreo (m³ est.)', s: 0 }, { v: r.est || 0, s: 2 }]
    ];
    var factor = numeroDesdeTexto(datos.factorMR);
    if (factor > 0 && r.est > 0) {
      filasReporte.push([{ v: 'Volumen sólido (factor apilamiento ' + String(factor).replace('.', ',') + ')', s: 0 }, { v: r.est * factor, s: 2 }]);
    }
    filasReporte.push([]);
    filasReporte.push([{ v: 'NOVEDADES DEL DÍA', s: 1 }]);
    filasReporte.push([{ v: datos.novedades || 'Sin novedades.', s: 4 }]);

    var hojas = [{ nombre: 'Reporte', anchos: [34, 18], filas: filasReporte }];

    // --- Hoja Cubicación JAS (mismo orden que la tabla de terreno) ---
    var fila1 = [{ v: 'DIÁM (cm)', s: 1 }];
    for (i = 0; i < LARGOS.length; i++) {
      fila1.push({ v: 'N° ' + LARGOS[i].nom.toFixed(2).replace('.', ',') + ' m', s: 1 });
      fila1.push({ v: 'M³', s: 1 });
    }
    fila1.push({ v: 'TOTAL N°', s: 1 });
    fila1.push({ v: 'TOTAL M³', s: 1 });

    var filasJAS = [fila1];
    for (i = 0; i < DIAMETROS.length; i++) {
      var diam = DIAMETROS[i];
      var fila = [diam];
      var totN = 0, totM3 = 0;
      for (j = 0; j < LARGOS.length; j++) {
        var porDiam = datos.conteo[String(LARGOS[j].nom)] || {};
        var cant = porDiam[String(diam)] || 0;
        var m3 = cant * volumenJAS(diam, LARGOS[j].nom);
        totN += cant;
        totM3 += m3;
        fila.push(cant || '');
        fila.push(cant ? { v: m3, s: 2 } : '');
      }
      fila.push(totN || '');
      fila.push(totN ? { v: totM3, s: 2 } : '');
      filasJAS.push(fila);
    }
    var filaTot = [{ v: 'TOTAL', s: 1 }];
    var granN = 0, granM3 = 0;
    for (j = 0; j < LARGOS.length; j++) {
      var t = totalesLargo(datos.conteo, j);
      granN += t.n;
      granM3 += t.m3;
      filaTot.push({ v: t.n, s: 1 });
      filaTot.push({ v: t.m3, s: 3 });
    }
    filaTot.push({ v: granN, s: 1 });
    filaTot.push({ v: granM3, s: 3 });
    filasJAS.push(filaTot);

    var anchosJAS = [10];
    for (i = 0; i < LARGOS.length; i++) { anchosJAS.push(10); anchosJAS.push(9); }
    anchosJAS.push(10); anchosJAS.push(10);
    hojas.push({ nombre: 'Cubicación JAS', anchos: anchosJAS, filas: filasJAS });

    // --- Hoja MR ---
    var filasMR = [[
      { v: 'N° ruma', s: 1 }, { v: 'Largo (m)', s: 1 }, { v: 'Altos medidos (m)', s: 1 },
      { v: 'Alto prom. (m)', s: 1 }, { v: 'MR', s: 1 }, { v: 'Largo trozo (m)', s: 1 },
      { v: 'M³ estéreo', s: 1 }
    ]];
    for (i = 0; i < datos.rumas.length; i++) {
      var ruma = datos.rumas[i];
      filasMR.push([
        i + 1,
        { v: ruma.largo, s: 2 },
        ruma.altos.map(function (a) { return String(a).replace('.', ','); }).join(' · '),
        { v: altoPromedio(ruma), s: 2 },
        { v: mrDeRuma(ruma), s: 2 },
        { v: ruma.trozo, s: 2 },
        { v: estereoDeRuma(ruma), s: 2 }
      ]);
    }
    filasMR.push([{ v: 'TOTAL', s: 1 }, '', '', '', { v: totalMR(datos.rumas), s: 3 }, '', { v: totalEstereo(datos.rumas), s: 3 }]);
    if (factor > 0) {
      filasMR.push([{ v: 'VOLUMEN SÓLIDO (factor ' + String(factor).replace('.', ',') + ')', s: 1 }, '', '', '', '', '', { v: totalEstereo(datos.rumas) * factor, s: 3 }]);
    }
    filasMR.push([]);
    filasMR.push(['Método: la ruma se mide por su cara. MR = largo × alto promedio.']);
    filasMR.push(['Volumen estéreo = MR × largo del trozo. Volumen sólido = estéreo × factor de apilamiento.']);
    hojas.push({ nombre: 'Metro ruma', anchos: [9, 11, 24, 13, 10, 14, 11], filas: filasMR });

    return hojas;
  }

  function descargar(blob, nombre) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }

  $('btnExcelDia').addEventListener('click', function () {
    descargar(MiniXLSX.crear(hojasDe(estado.actual)), nombreArchivo(estado.actual));
  });

  // Compartir el Excel directo (WhatsApp, correo…) donde el navegador lo permita.
  function puedeCompartirArchivos() {
    if (!navigator.canShare) return false;
    try {
      var prueba = new File(['x'], 'prueba.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      return navigator.canShare({ files: [prueba] });
    } catch (err) {
      return false;
    }
  }

  if (puedeCompartirArchivos()) {
    $('btnCompartirExcel').hidden = false;
    $('btnCompartirExcel').addEventListener('click', function () {
      var blob = MiniXLSX.crear(hojasDe(estado.actual));
      var archivo = new File([blob], nombreArchivo(estado.actual), { type: blob.type });
      navigator.share({ files: [archivo], title: 'Calibración forestal' }).catch(function () {});
    });
  }

  function textoReporte(datos) {
    var r = datos.tot || resumenDe(datos);
    var lineas = [
      '📋 REPORTE DIARIO — ' + fechaLegible(datos.fecha),
      ''
    ];
    if (datos.faena) lineas.push('Faena: ' + datos.faena);
    if (datos.maquina) lineas.push('Máquina: ' + datos.maquina);
    if (datos.operador) lineas.push('Operador: ' + datos.operador);
    lineas.push('');
    lineas.push('🪵 Producción:');
    lineas.push('• Trozos cubicados (JAS): ' + r.trozos);
    lineas.push('• Volumen JAS: ' + fmt(r.m3, 3) + ' m³');
    if (r.rumas) {
      lineas.push('• Rumas: ' + r.rumas + ' — ' + fmt(r.mr, 2) + ' MR — ' + fmt(r.est || 0, 2) + ' m³ est.');
      var factor = numeroDesdeTexto(datos.factorMR);
      if (factor > 0 && r.est > 0) lineas.push('• Volumen sólido: ' + fmt(r.est * factor, 3) + ' m³ (factor ' + fmt(factor, 2) + ')');
    }
    lineas.push('');
    lineas.push('📝 Novedades:');
    lineas.push(datos.novedades.trim() || 'Sin novedades.');
    return lineas.join('\n');
  }

  $('btnCompartirTexto').addEventListener('click', function () {
    var texto = textoReporte(estado.actual);
    if (navigator.share) {
      navigator.share({ text: texto }).catch(function () {});
    } else {
      window.open('https://wa.me/?text=' + encodeURIComponent(texto), '_blank');
    }
  });

  /* ================= Historial ================= */

  function pintarHistorial() {
    var h = estado.historial;
    if (!h.length) {
      $('listaHistorial').innerHTML = '<p class="vacio">Todavía no hay calibraciones guardadas.<br>Se guardan desde la pestaña Reporte.</p>';
      return;
    }
    var html = '';
    for (var i = 0; i < h.length; i++) {
      var it = h[i];
      var r = it.tot;
      html += '<div class="item-historial" data-id="' + it.id + '">' +
        '<h3>' + fechaLegible(it.fecha) + '</h3>' +
        '<p class="meta">' +
        (it.faena ? it.faena + ' · ' : '') +
        (it.maquina ? it.maquina + ' · ' : '') +
        (it.operador || '') + '</p>' +
        '<p class="cifras">' + r.trozos + ' trozos · ' + fmt(r.m3, 3) + ' m³ JAS' +
        (r.rumas ? ' · ' + fmt(r.mr, 2) + ' MR' : '') + '</p>' +
        (it.novedades.trim() ? '<p class="novedades">' + escaparHTML(it.novedades) + '</p>' : '') +
        '<div class="botones">' +
        '<button type="button" class="btn" data-accion="excel">📊 Excel</button>' +
        '<button type="button" class="btn" data-accion="compartir">💬 Compartir</button>' +
        '<button type="button" class="btn peligro" data-accion="eliminar">🗑</button>' +
        '</div></div>';
    }
    $('listaHistorial').innerHTML = html;
  }

  function escaparHTML(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  $('listaHistorial').addEventListener('click', function (ev) {
    var btn = ev.target.closest('button');
    if (!btn) return;
    var id = +btn.closest('.item-historial').getAttribute('data-id');
    var indice = -1;
    for (var i = 0; i < estado.historial.length; i++) {
      if (estado.historial[i].id === id) { indice = i; break; }
    }
    if (indice < 0) return;
    var it = estado.historial[indice];
    var accion = btn.getAttribute('data-accion');

    if (accion === 'excel') {
      descargar(MiniXLSX.crear(hojasDe(it)), nombreArchivo(it));
    } else if (accion === 'compartir') {
      var texto = textoReporte(it);
      if (navigator.share) navigator.share({ text: texto }).catch(function () {});
      else window.open('https://wa.me/?text=' + encodeURIComponent(texto), '_blank');
    } else if (accion === 'eliminar') {
      if (!confirm('¿Eliminar la calibración del ' + fechaLegible(it.fecha) + '? Esta acción no se puede deshacer.')) return;
      estado.historial.splice(indice, 1);
      guardar();
      pintarHistorial();
    }
  });

  $('btnExcelTodo').addEventListener('click', function () {
    if (!estado.historial.length) {
      alert('Todavía no hay calibraciones guardadas.');
      return;
    }
    var filas = [[
      { v: 'Fecha', s: 1 }, { v: 'Faena / Predio', s: 1 }, { v: 'Máquina', s: 1 },
      { v: 'Operador', s: 1 }, { v: 'Trozos', s: 1 }, { v: 'M³ JAS', s: 1 },
      { v: 'Rumas', s: 1 }, { v: 'MR', s: 1 }, { v: 'M³ est.', s: 1 }, { v: 'Novedades', s: 1 }
    ]];
    var totTrozos = 0, totM3 = 0, totMRr = 0, totEst = 0;
    for (var i = estado.historial.length - 1; i >= 0; i--) {
      var it = estado.historial[i];
      totTrozos += it.tot.trozos;
      totM3 += it.tot.m3;
      totMRr += it.tot.mr;
      totEst += it.tot.est || 0;
      filas.push([
        it.fecha, it.faena, it.maquina, it.operador,
        it.tot.trozos, { v: it.tot.m3, s: 2 },
        it.tot.rumas, { v: it.tot.mr, s: 2 }, { v: it.tot.est || 0, s: 2 },
        { v: it.novedades || '', s: 4 }
      ]);
    }
    filas.push([
      { v: 'TOTAL', s: 1 }, '', '', '',
      { v: totTrozos, s: 1 }, { v: totM3, s: 3 },
      '', { v: totMRr, s: 3 }, { v: totEst, s: 3 }, ''
    ]);
    var blob = MiniXLSX.crear([{
      nombre: 'Resumen',
      anchos: [12, 22, 22, 20, 9, 10, 8, 8, 9, 60],
      filas: filas
    }]);
    descargar(blob, 'historial_calibraciones.xlsx');
  });

  /* ================= Arranque ================= */

  $('fechaCabecera').textContent = new Date().toLocaleDateString('es-CL', {
    day: 'numeric', month: 'short', year: 'numeric'
  });

  if (!estado.actual.fecha) estado.actual.fecha = hoyISO();
  $('mrTrozo').value = '2.44';
  $('factorMR').value = estado.actual.factorMR || '';

  pintarChips();
  pintarGrid();
  pintarRumas();
  pintarReporte();
  pintarHistorial();

  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
