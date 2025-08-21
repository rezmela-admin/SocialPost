import fs from 'fs';
import { PDFDocument } from 'pdf-lib';

export async function exportToPdf(imagePath, outputPdfPath) {
    try {
        const imageBytes = fs.readFileSync(imagePath);
        const pdfDoc = await PDFDocument.create();
        
        let image;
        if (imagePath.toLowerCase().endsWith('.png')) {
            image = await pdfDoc.embedPng(imageBytes);
        } else if (imagePath.toLowerCase().endsWith('.jpg') || imagePath.toLowerCase().endsWith('.jpeg')) {
            image = await pdfDoc.embedJpg(imageBytes);
        } else {
            console.error(`[APP-ERROR] Unsupported image type for PDF export: ${imagePath}`);
            return;
        }

        const page = pdfDoc.addPage([image.width, image.height]);
        page.drawImage(image, {
            x: 0,
            y: 0,
            width: image.width,
            height: image.height,
        });

        const pdfBytes = await pdfDoc.save();
        fs.writeFileSync(outputPdfPath, pdfBytes);
        console.log(`
[APP-SUCCESS] Comic exported to PDF: ${outputPdfPath}`);
    } catch (error) {
        console.error(`[APP-ERROR] Failed to export PDF:`, error);
    }
}