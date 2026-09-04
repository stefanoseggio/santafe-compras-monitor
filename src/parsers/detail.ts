import type { CheerioAPI } from 'cheerio';

import type { GestionDetail, GestionDocument } from '../types.js';

// The detail page is a flat sequence of `<div class="col-12 mb-4">` blocks.
// Most are simple label/value pairs (`<b>Label:</b><span>Value</span>`);
// a few (Rubros / Subrubros, Organismo comitente) use one or more bare
// `<div>` instead of `<span>` for potentially multiple values. The
// Documentos block is structurally different: one `<h4>Documentos</h4>`
// followed by `<h5>Tipo</h5>` headers, each followed by one or more
// `<div><a href title>Nombre</a></div>` entries under that heading.
export function parseDetail($: CheerioAPI): GestionDetail {
    const fields: Record<string, string> = {};
    let rubros: string[] = [];
    const documentos: GestionDocument[] = [];

    $('div.col-12.mb-4').each((_i, el) => {
        const $block = $(el);

        if ($block.children('h4').filter((_j, h4) => $(h4).text().trim() === 'Documentos').length > 0) {
            let currentTipo = '';
            $block.children().each((_k, child) => {
                const $child = $(child);
                if (child.tagName === 'h5') {
                    currentTipo = $child.text().trim();
                    return;
                }
                if (child.tagName === 'div') {
                    const $a = $child.find('a').first();
                    if ($a.length === 0) return;
                    const href = $a.attr('href');
                    if (!href) return;
                    documentos.push({
                        tipo: currentTipo,
                        nombre: ($a.attr('title') ?? $a.text()).trim(),
                        url: new URL(href, 'https://www.santafe.gov.ar/gestionesdecompras/site/').toString(),
                    });
                }
            });
            return;
        }

        const $label = $block.children('b').first();
        if ($label.length === 0) return;
        const label = $label.text().trim().replace(/:$/, '');
        if (!label) return;

        const $span = $block.children('span').first();
        if ($span.length > 0) {
            fields[label] = $span.text().trim();
            return;
        }

        const values = $block
            .children('div')
            .map((_j, div) => $(div).text().trim())
            .get()
            .filter(Boolean);
        if (values.length === 0) return;

        fields[label] = values.join('; ');
        if (/^Rubros/i.test(label)) {
            rubros = values;
        }
    });

    return { fields, rubros, documentos };
}
