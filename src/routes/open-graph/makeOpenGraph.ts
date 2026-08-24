interface Options {
  largeImage?: boolean;
  url: string;
  title: string;
  imageUrl?: string;
  imageWidth?: number | null;
  imageHeight?: number | null;
  description: string;
  color?: string | null;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const makeOpenGraph = (opts: Options) => {
  const url = escapeHtml(opts.url);
  const title = escapeHtml(opts.title);
  const description = escapeHtml(opts.description);
  const imageUrl = opts.imageUrl ? escapeHtml(opts.imageUrl) : undefined;
  const color = escapeHtml(opts.color || '#4c93ff');

  const siteName = `<meta content="HUGIN" property="og:site_name" />`;
  const type = `<meta content="article" property="og:type" />`;
  const urlTag = `<meta content="${url}" property="og:url" />`;
  const titleTag = `<meta content="${title}" property="og:title" />`;
  const description1 = `<meta content="${description}" property="og:description" />`;
  const image = imageUrl ? `<meta content="${imageUrl}" property="og:image" />` : '';
  const imageWidth = opts.imageWidth ? `<meta content="${opts.imageWidth}" property="og:image:width" />` : '';
  const imageHeight = opts.imageHeight ? `<meta content="${opts.imageHeight}" property="og:image:height" />` : '';

  const themeColor = `<meta name="theme-color" content="${color}">`;

  const title1 = `<title>${title}</title>`;
  const title2 = `<meta name="title" content="${title}">`;
  const htmlDescription = `<meta name="description" content="${description}">`;

  const largeImage = opts.largeImage ? `<meta name="twitter:card" content="summary_large_image">` : '';
  const twitterDomain = `<meta name="twitter:domain" content="https://hugin.app">`;
  const twitterUrl = `<meta name="twitter:url" content="${url}">`;
  const twitterDescription = `<meta name="twitter:description" content="${description}">`;
  const twitterTitle = `<meta name="twitter:title" content="${title}">`;
  const twitterImage = imageUrl ? `<meta name="twitter:image" content="${imageUrl}">` : '';

  return `<!DOCTYPE html><html><head>${title1}${title2}${htmlDescription}${siteName}${type}${themeColor}${urlTag}${titleTag}${description1}${imageWidth}${imageHeight}${largeImage}${image}${twitterDomain}${twitterUrl}${twitterDescription}${twitterTitle}${twitterImage}</head></html>`;
};