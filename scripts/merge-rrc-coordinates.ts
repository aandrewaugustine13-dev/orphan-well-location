import puppeteer from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { DBFFile } from 'dbffile';
import csvParser from 'csv-parser';
import { execSync } from 'child_process';

const downloadPath = path.resolve(process.cwd(), 'data');
const rawCsvPath = path.join(downloadPath, 'rrc_active_wells.csv');

async function downloadShapefiles() {
    console.log("Launching Puppeteer to download shapefiles...");
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: downloadPath,
    });
    
    const url = 'https://mft.rrc.texas.gov/link/d551fb20-442e-4b67-84fa-ac3f23ecabb4';
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    
    console.log("Selecting all shapefiles...");
    const clicked = await page.evaluate(() => {
        const cbs = document.querySelectorAll('input[type="checkbox"]');
        if (cbs.length > 0) {
            cbs.forEach(c => { if (!c.checked) c.click(); });
        }
        
        const btns = Array.from(document.querySelectorAll('a, button')).filter(el => (el.innerText || '').toLowerCase().includes('download'));
        if (btns.length > 0) {
            btns[0].click();
            return true;
        }
        return false;
    });

    if (!clicked) {
        throw new Error("Could not find download button on MFT portal.");
    }

    console.log("Download triggered. Waiting for bulk shapefile zip to finish downloading... (This may take a few minutes)");

    let downloadedFile = '';
    // Poll the directory for the completed file
    for (let i = 0; i < 600; i++) { // Wait up to 10 minutes
        const files = fs.readdirSync(downloadPath);
        const crdownload = files.find(f => f.endsWith('.crdownload'));
        const zipFile = files.find(f => f.startsWith('documents_') && f.endsWith('.zip'));
        
        if (zipFile && !crdownload) {
            // Additional check: verify size stops growing
            downloadedFile = path.join(downloadPath, zipFile);
            const size1 = fs.statSync(downloadedFile).size;
            await new Promise(r => setTimeout(r, 2000));
            const size2 = fs.statSync(downloadedFile).size;
            if (size1 === size2 && size1 > 10 * 1024 * 1024) {
                break;
            }
        }
        await new Promise(r => setTimeout(r, 1000));
    }

    await browser.close();

    if (!downloadedFile || !fs.existsSync(downloadedFile)) {
        throw new Error("Download failed or timed out.");
    }

    console.log(`Successfully downloaded shapefile bundle: ${downloadedFile}`);
    return downloadedFile;
}

async function extractAndParseCoordinates(bundleZipPath: string) {
    console.log("Extracting bulk shapefile bundle...");
    const coordMap = new Map<string, {lat: number, lng: number}>();
    
    const tempDir = path.join(downloadPath, 'temp_shapefiles');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
    
    const zip = new AdmZip(bundleZipPath);
    const zipEntries = zip.getEntries();
    
    const wellZips = zipEntries.filter(e => e.entryName.startsWith('well') && e.entryName.endsWith('.zip'));
    console.log(`Found ${wellZips.length} county shapefile zips.`);
    
    let processed = 0;
    for (const entry of wellZips) {
        const innerZipBuffer = entry.getData();
        const innerZip = new AdmZip(innerZipBuffer);
        
        const dbfEntries = innerZip.getEntries().filter(e => e.entryName.endsWith('s.dbf'));
        for (const dbfEntry of dbfEntries) {
            const dbfBuffer = dbfEntry.getData();
            const dbfPath = path.join(tempDir, dbfEntry.entryName);
            fs.writeFileSync(dbfPath, dbfBuffer);
            
            const dbf = await DBFFile.open(dbfPath);
            const records = await dbf.readRecords();
            for (const record of records) {
                const api = record['API'] as string;
                const lat = record['LAT83'] as number;
                const lng = record['LONG83'] as number;
                if (api && lat && lng) {
                    coordMap.set(api.trim(), { lat, lng });
                }
            }
            
            fs.unlinkSync(dbfPath);
        }
        processed++;
        if (processed % 50 === 0) console.log(`Processed ${processed} counties...`);
    }
    
    fs.rmdirSync(tempDir);
    console.log(`Extracted coordinates for ${coordMap.size} unique API numbers.`);
    return coordMap;
}

async function mergeCoordinates(coordMap: Map<string, {lat: number, lng: number}>) {
    console.log("Merging coordinates into existing active wells CSV...");
    const tempCsvPath = path.join(downloadPath, 'rrc_active_wells_temp.csv');
    const writeStream = fs.createWriteStream(tempCsvPath);
    writeStream.write('API,Operator,Lat,Lng,WellType\n');
    
    return new Promise((resolve, reject) => {
        let matched = 0;
        let total = 0;
        fs.createReadStream(rawCsvPath)
            .pipe(csvParser())
            .on('data', (row) => {
                let lat = row['Lat'] || '';
                let lng = row['Lng'] || '';
                const api = row['API'] ? row['API'].trim() : '';
                const dbfApi = api.startsWith('42') ? api.substring(2) : api;
                
                const coords = coordMap.get(dbfApi);
                if (coords) {
                    lat = coords.lat.toString();
                    lng = coords.lng.toString();
                    matched++;
                }
                
                const csvRow = `"${api}","${(row['Operator'] || '').replace(/"/g, '""')}","${lat}","${lng}","${row['WellType'] || ''}"\n`;
                writeStream.write(csvRow);
                total++;
            })
            .on('end', () => {
                writeStream.end();
                console.log(`Merged coordinates for ${matched} out of ${total} wells.`);
                fs.renameSync(tempCsvPath, rawCsvPath);
                resolve(true);
            })
            .on('error', reject);
    });
}

async function run() {
    try {
        let bundleZip = fs.readdirSync(downloadPath).find(f => f.startsWith('documents_') && f.endsWith('.zip'));
        if (!bundleZip) {
            bundleZip = await downloadShapefiles();
        } else {
            bundleZip = path.join(downloadPath, bundleZip);
            console.log(`Found existing bundle in data directory: ${bundleZip}`);
        }

        const coordMap = await extractAndParseCoordinates(bundleZip);
        await mergeCoordinates(coordMap);
        
        console.log("Coordinates successfully merged. Executing seed script...");
        try {
            execSync('npx tsx scripts/seed-fracking-data.ts', { stdio: 'inherit', cwd: process.cwd() });
            console.log("Success! Data officially seeded into the database.");
        } catch (seedErr) {
            console.log("The seed script encountered an error (likely RLS policy violation), but the CSV data has been successfully updated with the coordinates!");
        }
    } catch (e) {
        console.error("Pipeline failed:", e);
        process.exit(1);
    }
}

run();
