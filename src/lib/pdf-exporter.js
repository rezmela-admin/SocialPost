import fs from 'fs';
import { PDFDocument, PageSizes, rgb } from 'pdf-lib';

/**
 * Exports an image to a PDF with specified page dimensions and margins.
 * The image is scaled to fit within the margins while maintaining its aspect ratio.
 *
 * @param {string} imagePath - The absolute path to the input image file.
 * @param {string} outputPdfPath - The absolute path where the output PDF will be saved.
 * @param {object} [options] - Optional parameters for PDF creation.
 * @param {Array<number>} [options.pageSize=[6, 9]] - The page size in inches, e.g., [width, height]. Defaults to 6x9.
 * @param {number} [options.margin=0.75] - The margin in inches for all sides. Defaults to 0.75.
 */
export async function exportToPdf(imagePath, outputPdfPath, options = {}) {
    try {
        // --- 1. Set up dimensions and options ---
        const { pageSize = [6, 9], margin = 0.75 } = options;
        const [pageWidthInches, pageHeightInches] = pageSize;

        // Convert inches to points (1 inch = 72 points)
        const pageWidth = pageWidthInches * 72;
        const pageHeight = pageHeightInches * 72;
        const marginPoints = margin * 72;

        const printableWidth = pageWidth - (marginPoints * 2);
        const printableHeight = pageHeight - (marginPoints * 2);

        // --- 2. Load Image and PDF Document ---
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

        // --- 3. Calculate Scaling ---
        const imageAspectRatio = image.width / image.height;
        const printableAreaAspectRatio = printableWidth / printableHeight;

        let scaledWidth, scaledHeight;
        if (imageAspectRatio > printableAreaAspectRatio) {
            // Image is wider than the printable area, so width is the limiting factor
            scaledWidth = printableWidth;
            scaledHeight = scaledWidth / imageAspectRatio;
        } else {
            // Image is taller than or equal to the printable area, so height is the limiting factor
            scaledHeight = printableHeight;
            scaledWidth = scaledHeight * imageAspectRatio;
        }

        // --- 4. Calculate Centered Position ---
        const x = marginPoints + (printableWidth - scaledWidth) / 2;
        const y = marginPoints + (printableHeight - scaledHeight) / 2;

        // --- 5. Add Page and Draw Image ---
        const page = pdfDoc.addPage([pageWidth, pageHeight]);
        page.drawImage(image, {
            x,
            y,
            width: scaledWidth,
            height: scaledHeight,
        });

        // --- 6. Save PDF ---
        const pdfBytes = await pdfDoc.save();
        fs.writeFileSync(outputPdfPath, pdfBytes);
        console.log(`\n[APP-SUCCESS] Comic exported to PDF: ${outputPdfPath}`);

    } catch (error) {
        console.error(`[APP-ERROR] Failed to export PDF:`, error);
    }
}