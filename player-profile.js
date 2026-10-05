(function () {
    const key='litecrib-portrait';
    let portrait='';
    try { portrait=localStorage.getItem(key)||''; } catch {}
    const valid=value=>typeof value==='string'&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value)&&value.length<160000;
    if(!valid(portrait))portrait='';
    function markup(name,local) {
        if(local&&portrait)return `<img class="seat-portrait" src="${portrait}" alt="Your player portrait">`;
        return '<span class="seat-portrait seat-empty" aria-label="Portrait slot">＋</span>';
    }
    window.PlayerProfile={markup};
    document.addEventListener('DOMContentLoaded',()=>{
        const input=document.getElementById('portrait-upload'), preview=document.getElementById('portrait-preview'), status=document.getElementById('portrait-status');
        const update=()=>{preview.innerHTML=markup('',true);};update();
        input.addEventListener('change',async()=>{
            const file=input.files[0];if(!file)return;
            try {
                if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024)throw new Error('Choose a JPG, PNG or WebP under 5 MB.');
                const bitmap=await createImageBitmap(file);
                const canvas=document.createElement('canvas');canvas.width=canvas.height=192;
                const side=Math.min(bitmap.width,bitmap.height);
                canvas.getContext('2d').drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,192,192);bitmap.close();
                const data=canvas.toDataURL('image/jpeg',.85);
                if(!valid(data))throw new Error('Image could not be resized. Try another photo.');
                localStorage.setItem(key,data);portrait=data;update();status.textContent='Portrait saved on this browser. It will appear at your seat.';
            }catch(e){status.textContent=e.message;}input.value='';
        });
        document.getElementById('portrait-remove').addEventListener('click',()=>{try{localStorage.removeItem(key);portrait='';update();status.textContent='Portrait removed.';}catch{status.textContent='Browser storage is unavailable.';}});
        const select=document.getElementById('country-select');
        for(const [value,country]of Object.entries(CountryBoards.countries))select.add(new Option(country.name+' — '+country.subtitle,value));
        select.value=CountryBoards.selected();
        select.addEventListener('change',()=>{
            try{localStorage.setItem('litecrib-country',select.value);}catch{}
            document.body.dataset.country=select.value;
            document.getElementById('country-preview').innerHTML=`<svg viewBox="0 0 860 520" aria-label="${CountryBoards.countries[select.value].name} board preview"><path d="${CountryBoards.geometry(select.value).outline}" fill="${CountryBoards.countries[select.value].color}" stroke="#090d18" stroke-width="7"/></svg>`;
        });select.dispatchEvent(new Event('change'));
    });
})();
