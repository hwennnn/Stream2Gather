export const isProd: boolean = process.env.NODE_ENV === 'production';
export const apiVersion: string = 'v1';
export const isServer: boolean = typeof window === 'undefined';
export const videoOverlayImageUrl =
  'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAACSCAYAAACE56BkAAAAAXNSR0IArs4c6QAAAWJJREFUKFNd0GlLlnEQxeGZbDNTS80sl9Qsl0qzTU3bXLJsQRARIkSQEEQkiBAiIpAQJCKICEQiEBGiDxnXjU8v8sWPM+ecmfv/GBn//3HyAJSVEAeVDsHhfWQeiYw4GpFZHpFRrnyMqoDj0gKVUMWrjoys1jvhyklBTWRGjbFWpY46pVLvcj11mtegfIYqcFbQyGuyBtnMa4nMPEcVaFVps9EuaDeeN3bABRWIi9Ap7aIgu6ke3qUS8rKfcEXQ65O9Xt/nBVeh/x+uqVyHG/vIuEndUhlwfoAadHnIqdvGYcEwb4S6A3elBe4Z77vygCow6gVj0nFPKzDBe8ibVJl0+ZG1x8apEuIJ9VTvmfQ5TPv4jGDW2pz0Be8lzPMWeIvUK96StWVqxdqq8bV/9htveau3Bu/gPXyAj9J1G59sbBg3PfwzfIGvjn6Tfjf+UN4ybsNPV37xdqhdlT3jbx//8xeo1yRudO2+cgAAAABJRU5ErkJggg==")';
