import zipfile
import os

z = zipfile.ZipFile(r'd:\自主开发程序\Mmap\build-log.zip')
for name in z.namelist()[:5]:
    print(f'=== {name} ===')
    content = z.read(name).decode('utf-8', errors='replace')
    print(content[:3000])
    print()
z.close()