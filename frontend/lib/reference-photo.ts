// Initial presentation photographs carry their public credit in the existing
// attachment name, so their authorship survives downloads and older clients.
export function referencePhotoCredit(name?: string | null) {
    if (!name?.startsWith('Foto de referencia · ')) return null;
    const fields = name.split(' · ');
    if (fields.length !== 5) return null;
    const [, caption, author, license, source] = fields;
    if (!caption || caption.length > 100 || !author || author.length > 150 || !license || license.length > 40 || source.length > 600) return null;
    try {
        const url = new URL(source);
        if (url.protocol !== 'https:' || url.hostname !== 'commons.wikimedia.org' || url.port || url.username || url.password || !/^\/wiki\/File(?::|%3A)/i.test(url.pathname)) return null;
        return { caption, author, license, source: url.href };
    } catch { return null; }
}
