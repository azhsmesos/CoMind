import {
  MAX_RESUME_FILE_BYTES,
  MAX_RESUME_IMAGE_CHARS,
  MAX_RESUME_PAGES,
  type ResumeUpload,
} from "./types";

function jpeg(canvas: HTMLCanvasElement) {
  const image = canvas.toDataURL("image/jpeg", 0.88);
  if (!image.startsWith("data:image/jpeg;base64,") || image.length > 7_000_000)
    throw new Error("简历图片过大，请压缩后重试");
  return image;
}

export async function prepareResume(
  file: File,
  progress: (text: string) => void,
): Promise<ResumeUpload> {
  if (!file.size || file.size > MAX_RESUME_FILE_BYTES)
    throw new Error("请选择非空且不超过 20 MB 的简历文件");
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  if (extension === "doc" || extension === "docx")
    return { kind: "word", data: new Uint8Array(await file.arrayBuffer()) };
  if (extension === "pdf") {
    const pdfjs = await import("pdfjs-dist");
    const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const assets = new URL("pdfjs/", document.baseURI).href;
    const task = pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      cMapUrl: assets + "cmaps/",
      cMapPacked: true,
      standardFontDataUrl: assets + "standard_fonts/",
      wasmUrl: assets + "wasm/",
      iccUrl: assets + "iccs/",
    });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > MAX_RESUME_PAGES)
        throw new Error("简历 PDF 最多支持 10 页，请精简后上传");
      const images: string[] = [];
      let total = 0;
      for (let i = 1; i <= pdf.numPages; i++) {
        progress(`正在读取 PDF ${i}/${pdf.numPages} 页…`);
        const page = await pdf.getPage(i);
        const original = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({
          scale: Math.min(
            2.5,
            2400 / Math.max(original.width, original.height),
          ),
        });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, viewport, background: "rgb(255,255,255)" })
          .promise;
        const image = jpeg(canvas);
        canvas.width = canvas.height = 0;
        page.cleanup();
        total += image.length;
        if (total > MAX_RESUME_IMAGE_CHARS)
          throw new Error("PDF 转换后的图片过大，请减少页数后重试");
        images.push(image);
      }
      return { kind: "images", images };
    } catch (error) {
      if (error instanceof Error && error.name === "PasswordException")
        throw new Error("PDF 已加密，请先移除密码后上传");
      if (error instanceof Error && error.name === "InvalidPDFException")
        throw new Error("PDF 无法读取，请确认文件未损坏");
      throw error;
    } finally {
      await task.destroy();
    }
  }
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(extension || "")) {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw new Error("图片无法读取，请上传有效的 PNG、JPEG、WebP 或 GIF 图片");
    }
    try {
      const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d")!;
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return { kind: "images", images: [jpeg(canvas)] };
    } finally {
      bitmap.close();
    }
  }
  throw new Error("支持 PDF、Word（.doc/.docx）、PNG、JPEG、WebP 和 GIF 文件");
}
