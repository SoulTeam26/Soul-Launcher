// SOUL — spawns hand-drawn blob ghosts into .ghost-layer containers
(function(){
  function ghostSVG(){
    // loose rounded blob outline, 2 oval eyes, occasional mouth notch
    const mouth = Math.random() > 0.55;
    return `<svg viewBox="0 0 120 130" xmlns="http://www.w3.org/2000/svg">
      <path class="body" d="M60 6c-22 0-34 13-37 30-2 11 3 17 0 27-3 9-9 13-7 21 2 7 10 6 14 1 3 7 11 8 14 2 3 8 12 8 15 0 3 6 11 5 14-2 4 5 12 6 14-1 2-8-4-12-7-21-3-10 2-16 0-27C94 19 82 6 60 6Z"/>
      <ellipse class="eye" cx="46" cy="52" rx="7" ry="9"/>
      <ellipse class="eye" cx="76" cy="50" rx="6" ry="8"/>
      ${mouth ? '<path class="eye" d="M50 76c4 8 16 8 20 0c-2 6-18 6-20 0Z"/>' : ''}
    </svg>`;
  }
  window.spawnGhosts = function(count, opts){
    opts = opts || {};
    document.querySelectorAll('.ghost-layer').forEach(layer => {
      for(let i=0;i<count;i++){
        const g = document.createElement('div');
        const size = 60 + Math.random()*90;
        const dur = 38 + Math.random()*40;
        const delay = -Math.random()*dur;
        const dim = ['g-dim','','g-bright'][Math.floor(Math.random()*3)];
        g.className = 'ghost ' + dim;
        g.style.width = size+'px'; g.style.height = size*1.08+'px';
        g.style.top = (Math.random()*70)+'%';
        g.style.animationDuration = dur+'s';
        g.style.animationDelay = delay+'s';
        g.innerHTML = ghostSVG();
        layer.appendChild(g);
      }
    });
  };
})();
