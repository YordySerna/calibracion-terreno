/* MiniXLSX — generador de archivos .xlsx sin dependencias.
   Un .xlsx es un ZIP con XMLs adentro; acá se arma el ZIP sin compresión
   (método "stored"), que Excel y LibreOffice leen sin problema.

   Uso:
     var blob = MiniXLSX.crear([
       { nombre: "Hoja 1", anchos: [12, 20], filas: [
           [ {v:"Título", s:1}, "texto", 12.5, {v:0.123, s:2} ]
       ]}
     ]);
   Estilos (s): 0 normal · 1 negrita · 2 número 3 decimales
                3 negrita 3 decimales · 4 texto con salto de línea
*/
var MiniXLSX = (function () {
  'use strict';

  var codificador = new TextEncoder();

  /* ---------- CRC-32 (lo exige el formato ZIP) ---------- */
  var TABLA_CRC = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c;
    }
    return t;
  })();

  function crc32(datos) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < datos.length; i++) c = TABLA_CRC[(c ^ datos[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ---------- ZIP sin compresión ---------- */
  function fechaHoraDOS(d) {
    return {
      hora: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      fecha: (((d.getFullYear() - 1980) & 0x7F) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    };
  }

  function zip(entradas) {
    var partes = [], central = [], offset = 0, ahora = fechaHoraDOS(new Date());

    for (var i = 0; i < entradas.length; i++) {
      var nombre = codificador.encode(entradas[i].nombre);
      var datos = entradas[i].datos;
      var crc = crc32(datos), n = datos.length;

      var loc = new DataView(new ArrayBuffer(30));
      loc.setUint32(0, 0x04034b50, true);
      loc.setUint16(4, 20, true);       // versión mínima
      loc.setUint16(6, 0x0800, true);   // nombres en UTF-8
      loc.setUint16(8, 0, true);        // sin compresión
      loc.setUint16(10, ahora.hora, true);
      loc.setUint16(12, ahora.fecha, true);
      loc.setUint32(14, crc, true);
      loc.setUint32(18, n, true);
      loc.setUint32(22, n, true);
      loc.setUint16(26, nombre.length, true);
      loc.setUint16(28, 0, true);
      partes.push(new Uint8Array(loc.buffer), nombre, datos);

      var cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true);
      cen.setUint16(4, 20, true);
      cen.setUint16(6, 20, true);
      cen.setUint16(8, 0x0800, true);
      cen.setUint16(10, 0, true);
      cen.setUint16(12, ahora.hora, true);
      cen.setUint16(14, ahora.fecha, true);
      cen.setUint32(16, crc, true);
      cen.setUint32(20, n, true);
      cen.setUint32(24, n, true);
      cen.setUint16(28, nombre.length, true);
      cen.setUint32(42, offset, true);
      central.push(new Uint8Array(cen.buffer), nombre);

      offset += 30 + nombre.length + n;
    }

    var tamCentral = 0;
    for (i = 0; i < central.length; i++) tamCentral += central[i].length;

    var fin = new DataView(new ArrayBuffer(22));
    fin.setUint32(0, 0x06054b50, true);
    fin.setUint16(8, entradas.length, true);
    fin.setUint16(10, entradas.length, true);
    fin.setUint32(12, tamCentral, true);
    fin.setUint32(16, offset, true);

    var todo = partes.concat(central, [new Uint8Array(fin.buffer)]);
    var total = 0;
    for (i = 0; i < todo.length; i++) total += todo[i].length;
    var salida = new Uint8Array(total), pos = 0;
    for (i = 0; i < todo.length; i++) { salida.set(todo[i], pos); pos += todo[i].length; }
    return salida;
  }

  /* ---------- XMLs del formato xlsx ---------- */
  function escaparXML(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function letraColumna(indice) {
    var s = '', n = indice + 1;
    while (n > 0) {
      var m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function xmlHoja(hoja) {
    var xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
    if (hoja.anchos && hoja.anchos.length) {
      xml += '<cols>';
      for (var i = 0; i < hoja.anchos.length; i++) {
        xml += '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + hoja.anchos[i] + '" customWidth="1"/>';
      }
      xml += '</cols>';
    }
    xml += '<sheetData>';
    for (var r = 0; r < hoja.filas.length; r++) {
      var fila = hoja.filas[r] || [];
      xml += '<row r="' + (r + 1) + '">';
      for (var c = 0; c < fila.length; c++) {
        var celda = fila[c];
        if (celda === null || celda === undefined || celda === '') continue;
        var v = celda, estilo = 0;
        if (typeof celda === 'object') {
          v = celda.v;
          estilo = celda.s || 0;
          if (v === null || v === undefined || v === '') continue;
        }
        var ref = letraColumna(c) + (r + 1);
        if (typeof v === 'number' && isFinite(v)) {
          xml += '<c r="' + ref + '" s="' + estilo + '"><v>' + v + '</v></c>';
        } else {
          xml += '<c r="' + ref + '" s="' + estilo + '" t="inlineStr"><is><t xml:space="preserve">' +
                 escaparXML(v) + '</t></is></c>';
        }
      }
      xml += '</row>';
    }
    xml += '</sheetData></worksheet>';
    return xml;
  }

  var XML_ESTILOS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="0.000"/></numFmts>' +
    '<fonts count="2">' +
    '<font><sz val="11"/><name val="Arial"/></font>' +
    '<font><b/><sz val="11"/><name val="Arial"/></font>' +
    '</fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="5">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">' +
    '<alignment wrapText="1" vertical="top"/></xf>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  function crear(hojas) {
    var i;

    var tipos = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';
    for (i = 0; i < hojas.length; i++) {
      tipos += '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
    }
    tipos += '</Types>';

    var relsRaiz = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';

    var libro = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>';
    for (i = 0; i < hojas.length; i++) {
      libro += '<sheet name="' + escaparXML(hojas[i].nombre.substring(0, 31)) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
    }
    libro += '</sheets></workbook>';

    var relsLibro = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
    for (i = 0; i < hojas.length; i++) {
      relsLibro += '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
    }
    relsLibro += '<Relationship Id="rId' + (hojas.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';

    var entradas = [
      { nombre: '[Content_Types].xml', datos: codificador.encode(tipos) },
      { nombre: '_rels/.rels', datos: codificador.encode(relsRaiz) },
      { nombre: 'xl/workbook.xml', datos: codificador.encode(libro) },
      { nombre: 'xl/_rels/workbook.xml.rels', datos: codificador.encode(relsLibro) },
      { nombre: 'xl/styles.xml', datos: codificador.encode(XML_ESTILOS) }
    ];
    for (i = 0; i < hojas.length; i++) {
      entradas.push({ nombre: 'xl/worksheets/sheet' + (i + 1) + '.xml', datos: codificador.encode(xmlHoja(hojas[i])) });
    }

    return new Blob([zip(entradas)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }

  return { crear: crear };
})();
