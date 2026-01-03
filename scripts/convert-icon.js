/**
 * Script para converter PNG para ICO com múltiplas resoluções
 * Execute: node scripts/convert-icon.js
 * 
 * Requer: npm install sharp png-to-ico --save-dev
 */

const fs = require('fs');
const path = require('path');

async function convertPngToIco() {
    try {
        // Importação dinâmica para ESM module
        const pngToIco = (await import('png-to-ico')).default;
        const sharp = (await import('sharp')).default;
        
        const inputPath = path.join(__dirname, '..', 'src', 'assets', 'icon.png');
        const outputPath = path.join(__dirname, '..', 'build', 'icon.ico');
        const tempDir = path.join(__dirname, '..', 'build', 'temp-icons');
        
        // Criar diretório temporário
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        // Tamanhos necessários para o ICO
        const sizes = [16, 32, 48, 64, 128, 256];
        const pngFiles = [];
        
        console.log('📦 Gerando ícones em múltiplas resoluções...');
        
        for (const size of sizes) {
            const outputFile = path.join(tempDir, `icon-${size}.png`);
            await sharp(inputPath)
                .resize(size, size, {
                    fit: 'contain',
                    background: { r: 0, g: 0, b: 0, alpha: 0 }
                })
                .png()
                .toFile(outputFile);
            pngFiles.push(outputFile);
            console.log(`  ✓ Gerado: ${size}x${size}`);
        }
        
        console.log('🔄 Convertendo para ICO...');
        
        // Converter para ICO
        const icoBuffer = await pngToIco(pngFiles);
        fs.writeFileSync(outputPath, icoBuffer);
        
        console.log(`✅ Ícone criado: ${outputPath}`);
        
        // Limpar arquivos temporários
        for (const file of pngFiles) {
            fs.unlinkSync(file);
        }
        fs.rmdirSync(tempDir);
        
        console.log('🧹 Arquivos temporários removidos');
        console.log('\n🎉 Conversão concluída com sucesso!');
        
    } catch (error) {
        console.error('❌ Erro na conversão:', error.message);
        console.log('\n💡 Certifique-se de instalar as dependências:');
        console.log('   npm install sharp png-to-ico --save-dev');
        process.exit(1);
    }
}

convertPngToIco();
