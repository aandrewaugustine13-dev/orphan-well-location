import puppeteer from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
import csvParser from 'csv-parser';

async function processCSV(inputPath: string, outputPath: string) {
    console.log(`Processing raw data into ${outputPath}...`);
    const results: any[] = [];
    
    // We are looking for Active Wells (e.g., status is PRODUCING or ACTIVE, or we just write all for now).
    // The CSV has no headers.
    // Based on inspection:
    // col 2: API
    // col 4: WellType (e.g., "O" for Oil, "G" for Gas)
    // col 11: Operator
    // col 18: Status (e.g. "SHUT IN", "PRODUCING")
    
    const headers = ['API', 'Operator', 'Lat', 'Lng', 'WellType'];
    
    fs.writeFileSync(outputPath, headers.join(',') + '\n', 'utf8');

    return new Promise((resolve, reject) => {
        let count = 0;
        fs.createReadStream(inputPath)
            .pipe(csvParser({ headers: false }))
            .on('data', (data: any) => {
                // If it's the first row and looks like a header, skip it, but this file has no headers
                
                const api = data['2'] ? '42' + data['2'].trim() : ''; // Add Texas state code 42 if missing
                const operator = data['11'] ? data['11'].trim() : '';
                const wellType = data['4'] ? data['4'].trim() : '';
                const status = data['18'] ? data['18'].trim() : '';

                // Only include if "Active" or "Producing"
                if (status === 'PRODUCING' || status === 'ACTIVE') {
                    // Raw data does not provide Lat/Lng in this report
                    const lat = '';
                    const lng = '';
                    
                    const row = `"${api}","${operator.replace(/"/g, '""')}","${lat}","${lng}","${wellType}"\n`;
                    fs.appendFileSync(outputPath, row, 'utf8');
                    count++;
                }
            })
            .on('end', () => {
                console.log(`Finished processing. Wrote ${count} active wells to ${outputPath}`);
                resolve(true);
            })
            .on('error', reject);
    });
}

async function downloadRRCData() {
    const downloadPath = path.resolve(process.cwd(), 'data');
    if (!fs.existsSync(downloadPath)) {
        fs.mkdirSync(downloadPath, { recursive: true });
    }

    // Clean up any old downloads
    for (const file of fs.readdirSync(downloadPath)) {
        if (file.startsWith('OG_WELLBORE_EWA_Report') || file === 'rrc_active_wells.csv') {
            fs.unlinkSync(path.join(downloadPath, file));
        }
    }

    console.log("Launching Puppeteer...");
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
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36');

    const url = 'https://mft.rrc.texas.gov/link/650649b7-e019-4d77-a8e0-d118d6455381';
    console.log(`Navigating to MFT portal: ${url}`);

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    
    console.log("Searching for the CSV file link...");
    const clicked = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        const target = links.find(a => a.textContent?.trim() === 'OG_WELLBORE_EWA_Report.csv') 
                    || links.find(a => a.textContent?.includes('OG_WELLBORE_EWA_Report') && a.textContent?.includes('.csv'));
        if (target) {
            target.click();
            return true;
        }
        return false;
    });

    if (!clicked) {
        console.error("Could not find the CSV file to download on the MFT page.");
        await browser.close();
        return;
    }

    console.log("Download triggered. Waiting for file to finish downloading...");

    let downloadedFile = '';
    for (let i = 0; i < 120; i++) {
        const files = fs.readdirSync(downloadPath);
        const crdownload = files.find(f => f.endsWith('.crdownload'));
        const csvFile = files.find(f => f.startsWith('OG_WELLBORE_EWA_Report') && f.endsWith('.csv'));
        
        if (csvFile && !crdownload) {
            downloadedFile = path.join(downloadPath, csvFile);
            const stats = fs.statSync(downloadedFile);
            if (stats.size > 1024) {
                break; // Download complete
            }
        }
        await new Promise(r => setTimeout(r, 1000));
    }

    await browser.close();

    if (!downloadedFile || !fs.existsSync(downloadedFile)) {
        console.error("Download failed or timed out.");
        return;
    }

    console.log(`Successfully downloaded raw data to: ${downloadedFile}`);

    // Process the file
    const outputPath = path.join(downloadPath, 'rrc_active_wells.csv');
    await processCSV(downloadedFile, outputPath);
}

downloadRRCData().catch(console.error);
