import {describe,it,expect} from 'vitest';
import {zipSync,strToU8} from 'fflate';
import {parseImport,parseCSV,CSV_TEMPLATE,MAX_FILE_BYTES} from '../src/lib/import/parse.js';
const row=['TEST PERSON','00123456','2000-01-01','IDN','IDN','1','2035-01-01','test@example.com','62','0012345678'];
const workbook = values => {
  const rows=[CSV_TEMPLATE.trim().split(','),values].map((cells,rowIndex)=>`<row r="${rowIndex+1}">${cells.map((cell,column)=>`<c r="${String.fromCharCode(65+column)}${rowIndex+1}" t="inlineStr"><is><t>${cell}</t></is></c>`).join('')}</row>`).join('');
  const xml={
    '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
    '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Profiles" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`
  };
  return new File([zipSync(Object.fromEntries(Object.entries(xml).map(([name,value])=>[name,strToU8(value)])))],'profiles.xlsx');
};
describe('reviewable imports',()=>{
  it('preserves quoted CSV fields, newlines and leading zeros',async()=>{
    expect(parseCSV('a,b\n"a,b","x""y"\n')).toEqual([['a','b'],['a,b','x"y']]);
    const result=await parseImport(new File([CSV_TEMPLATE+row.join(',')],'profiles.csv'));
    expect(result.rows[0].profile.passportNo).toBe('00123456');
    expect(result.rows[0].profile.phone).toBe('0012345678');
    expect(result.rows[0].issues).toEqual([]);
  });
  it('exposes missing mapping and ambiguous dates before saving',async()=>{
    const result=await parseImport(new File(['Full name,birthDate\nTEST PERSON,01/02/2000'],'profiles.csv'),{name:'Full name'});
    expect(result.rows[0].profile.name).toBe('TEST PERSON');
    expect(result.rows[0].issues).toContain('Tanggal lahir tidak valid. Gunakan YYYY-MM-DD.');
    expect(result.warnings[0]).toContain('passportNo');
  });
  it('parses XLSX string cells with identifiers intact',async()=>{
    const {JSDOM}=await import('jsdom');globalThis.DOMParser=new JSDOM().window.DOMParser;
    const result=await parseImport(workbook(row));
    expect(result.rows[0].profile.passportNo).toBe('00123456');
    expect(result.rows[0].issues).toEqual([]);
  });
  it('rejects oversize files and unterminated quotes',async()=>{
    await expect(parseImport({name:'a.csv',size:MAX_FILE_BYTES+1})).rejects.toThrow('8 MB');
    expect(()=>parseCSV('a\n"broken')).toThrow('belum ditutup');
  });
});
