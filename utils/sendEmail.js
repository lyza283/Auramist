const nodemailer = require("nodemailer");
const pdf = require('html-pdf'); // Make sure to install html-pdf: npm install html-pdf

const sendEmail = async ({ email, subject, message, attachPdf = false, pdfFilename = 'Receipt.pdf' }) => {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    const mailOptions = {
      from: '"ROMEROS KINGDOM" <noreply@romeros.com>',
      to: email,
      subject: subject,
      html: message
    };

    if (attachPdf) {
      const options = { format: 'A4', border: '10mm' };
      
      // Convert HTML to PDF
      const pdfBuffer = await new Promise((resolve, reject) => {
        pdf.create(message, options).toBuffer((err, buffer) => {
          if (err) return reject(err);
          resolve(buffer);
        });
      });

      mailOptions.attachments = [{
        filename: pdfFilename,
        content: pdfBuffer,
        contentType: 'application/pdf'
      }];
    }

    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error('Email sending error:', error);
    throw error;
  }
};

module.exports = sendEmail;