
    // Koneksi ke Supabase Asli!
    const supabaseUrl = 'https://znyvnmrnhepldmlesgqa.supabase.co';
    const supabaseKey = 'sb_publishable_3UlKBMCHIaxuTjJw0LdkKQ_xoqqdERr';
    
    // Supabase diinisialisasi
    const _supabase = supabase.createClient(supabaseUrl, supabaseKey);
  

    let userData = JSON.parse(localStorage.getItem('shopee_inv_user')) || null;
    let html5QrcodeScanner = null;
    let isScanning = false;
    let scanCooldown = false;
    
    let currentDayHistory = [];
    let localStats = {}; 
    let activeCourierFilter = null; 
    let showAllHistory = false;

    // SISTEM ANTRIAN (OFFLINE MODE)
    let syncQueue = [];
    let isSyncing = false;

    // SISTEM SUARA & GETAR
    let audioCtx = null;
    function playBeep(type) {
      try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        if (type === 'success') {
          oscillator.type = 'sine';
          oscillator.frequency.setValueAtTime(1000, audioCtx.currentTime); 
          gainNode.gain.setValueAtTime(1, audioCtx.currentTime);
          oscillator.start();
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
          oscillator.stop(audioCtx.currentTime + 0.1);
        } else if (type === 'error') {
          oscillator.type = 'sawtooth';
          oscillator.frequency.setValueAtTime(300, audioCtx.currentTime); 
          gainNode.gain.setValueAtTime(1, audioCtx.currentTime);
          oscillator.start();
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);
          oscillator.stop(audioCtx.currentTime + 0.4);
        }
      } catch(e) {}
      
      try {
        if (type === 'success') navigator.vibrate(50);
        if (type === 'error') navigator.vibrate([200, 100, 200]);
      } catch(e) {}
    }

    // Set default date to today
    const tzOffset = (new Date()).getTimezoneOffset() * 60000;
    const localISOTime = (new Date(Date.now() - tzOffset)).toISOString().slice(0, 10);
    document.getElementById('start-date').value = localISOTime;
    document.getElementById('end-date').value = localISOTime;

    if (userData && userData.kode) {
      showPage('dashboard-page');
      document.getElementById('seller-name-label').innerText = userData.nama;
      loadDashboard();
    } else {
      showPage('login-page');
    }

    function toggleStats(forceShow = null) {
      const body = document.getElementById('stats-body');
      const icon = document.getElementById('stats-icon');
      
      let shouldShow = body.classList.contains('hidden');
      if (forceShow !== null) shouldShow = forceShow;
      
      if (shouldShow) {
        body.classList.remove('hidden');
        icon.style.transform = 'rotate(0deg)';
      } else {
        body.classList.add('hidden');
        icon.style.transform = 'rotate(-90deg)';
      }
    }

    function showPage(pageId) {
      document.getElementById('auth-container').classList.add('hidden');
      document.getElementById('dashboard-page').classList.add('hidden');
      document.getElementById(pageId).classList.remove('hidden');
    }

    function showToast(msg, type = "normal") {
      const toast = document.getElementById('toast');
      toast.innerText = msg;
      toast.classList.remove('hidden', 'bg-gray-900', 'bg-red-600', 'bg-green-600', 'translate-y-[-100%]');
      
      if (type === 'error') toast.classList.add('bg-red-600');
      else if (type === 'success') toast.classList.add('bg-green-600');
      else toast.classList.add('bg-gray-900');
      
      setTimeout(() => toast.classList.add('hidden'), 3000);
    }

    async function doLogin() {
      const kode = document.getElementById('login-kode').value.trim();
      if (!kode) { showToast("Kode unik wajib diisi!", "error"); return; }
      document.getElementById('btn-login').innerText = "Memproses...";
      
      // Pada versi ini kita langsung menggunakan kode gudang sebagai Workspace ID
      localStorage.setItem('shopee_inv_user', JSON.stringify({ nama: "Gudang " + kode, kode: kode }));
      userData = JSON.parse(localStorage.getItem('shopee_inv_user'));
      document.getElementById('seller-name-label').innerText = userData.nama;
      document.getElementById('btn-login').innerText = "Masuk Workspace";
      showPage('dashboard-page');
      loadDashboard();
    }

    function doLogout() {
      if(confirm("Yakin ingin keluar?")) {
        if(isScanning) toggleScan(); 
        localStorage.removeItem('shopee_inv_user');
        userData = null;
        showPage('login-page');
      }
    }

    function detectCourier(resi) {
      resi = resi.toUpperCase().trim();
      if (resi.startsWith("SHPE")) return "Pos Indonesia";
      if (resi.startsWith("SPX") || resi.startsWith("ID")) return "SPX Express";
      if (resi.startsWith("JP") || resi.startsWith("JX") || resi.startsWith("JD")) return "J&T Cargo";
      if (resi.match(/^[0-9]{12}$/) && !resi.startsWith("00")) return "J&T Cargo";
      if (resi.startsWith("00") && resi.length === 12) return "SiCepat";
      if (resi.startsWith("100") && resi.length === 14) return "AnterAja";
      if (resi.match(/^[0-9]{15}$/)) return "JNE";
      if (resi.match(/^[0-9]{11}$/) || resi.match(/^[A-Z]{2}[0-9]{9}[A-Z]{2}$/)) return "Pos Indonesia";
      return "Lainnya";
    }

    function renderHistoryList(filterCourier = null) {
      activeCourierFilter = filterCourier;
      const list = document.getElementById('history-list');
      list.innerHTML = '';
      
      let filtered = currentDayHistory;
      if (filterCourier) {
        filtered = currentDayHistory.filter(item => item.courier === filterCourier);
        document.getElementById('history-title').innerText = `Riwayat: ${filterCourier} (${filtered.length})`;
      } else {
        document.getElementById('history-title').innerText = `Riwayat Scan (${filtered.length})`;
      }

      if (filtered.length === 0) {
        list.innerHTML = '<div class="text-center text-gray-400 text-sm mt-4">Belum ada data scan.</div>';
        renderStats();
        return;
      }

      const limit = showAllHistory ? filtered.length : 10;
      const displayData = filtered.slice(0, limit);

      displayData.forEach(item => {
        let statusBadge = '';
        let borderClass = 'border-gray-100';
        let bgClass = 'bg-white';
        
        if (item.status === 'syncing') {
           statusBadge = `<span class="text-[10px] bg-yellow-100 text-yellow-700 px-1 rounded ml-2 border border-yellow-200">⏳ Menyimpan...</span>`;
        } else if (item.status === 'offline') {
           statusBadge = `<span class="text-[10px] bg-red-100 text-red-700 px-1 rounded ml-2 border border-red-200">⚠️ Menunggu Sinyal</span>`;
           borderClass = 'border-red-200';
           bgClass = 'bg-red-50';
        } else if (item.status === 'error') {
           statusBadge = `<span class="text-[10px] bg-red-100 text-red-700 px-1 rounded ml-2 border border-red-200">❌ ${item.errMsg||'Gagal'}</span>`;
           borderClass = 'border-red-300';
           bgClass = 'bg-red-50';
        }
        
        list.innerHTML += `
          <div class="${bgClass} p-3 rounded-lg border ${borderClass} flex justify-between items-center transition-all">
            <div>
              <div class="font-bold text-gray-800 font-mono flex items-center">
                ${item.resi} ${statusBadge}
              </div>
              <div class="text-xs text-gray-500">${item.time}</div>
            </div>
            <div class="bg-gray-100 text-[10px] font-bold px-2 py-1 rounded text-gray-600 border border-gray-200">${item.courier}</div>
          </div>`;
      });

      if (!showAllHistory && filtered.length > 10) {
        let filterArg = activeCourierFilter ? `'${activeCourierFilter}'` : 'null';
        list.innerHTML += `<button id="btn-show-all" onclick="handleShowAll(${filterArg})" class="w-full mt-2 bg-gray-100 hover:bg-gray-200 text-gray-600 py-2 rounded-lg font-bold text-xs shadow-sm transition">Tampilkan Semua (${filtered.length})</button>`;
      } else if (showAllHistory && filtered.length > 10) {
        let filterArg = activeCourierFilter ? `'${activeCourierFilter}'` : 'null';
        list.innerHTML += `<button onclick="showAllHistory=false; renderHistoryList(${filterArg})" class="w-full mt-2 bg-gray-100 hover:bg-gray-200 text-gray-600 py-2 rounded-lg font-bold text-xs shadow-sm transition">Tampilkan Lebih Sedikit (10)</button>`;
      }
      
      renderStats();
    }

    function handleShowAll(courier = null) {
      const btn = document.getElementById('btn-show-all');
      if (btn) btn.innerHTML = `<div class="spinner mr-2" style="width:12px;height:12px;border-width:2px;"></div> Memuat data...`;
      setTimeout(() => {
        showAllHistory = true;
        renderHistoryList(courier);
      }, 50);
    }

    function showHistoryFromStats(courier = null) {
      showAllHistory = false;
      document.getElementById('history-container').classList.remove('hidden');
      renderHistoryList(courier);
      setTimeout(() => document.getElementById('history-container').scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    }

    function renderStats() {
      let statsHtml = '';
      let total = 0;
      
      for (const [courier, count] of Object.entries(localStats)) {
        if (count <= 0) continue;
        const isActive = activeCourierFilter === courier;
        const bgClass = isActive ? 'bg-blue-600 text-white shadow-md transform scale-[1.02] border-blue-600' : 'bg-gray-50 hover:bg-gray-100 text-gray-700 border-gray-200';
        const badgeClass = isActive ? 'bg-white text-blue-800' : 'bg-blue-100 text-blue-800';
        
        statsHtml += `<div onclick="showHistoryFromStats('${courier}')" class="${bgClass} cursor-pointer p-3 rounded-xl border flex justify-between items-center transition-all duration-200">
                        <span class="font-bold text-sm">${courier}</span>
                        <span class="${badgeClass} font-bold px-2 py-1 rounded-md text-xs shadow-sm">${count}</span>
                      </div>`;
        total += count;
      }
      
      if (total === 0) {
        statsHtml = `<div class="col-span-2 text-gray-400 text-center py-4 bg-gray-50 rounded-xl border border-dashed border-gray-200">Belum ada kiriman.</div>`;
      } else {
        const isAllActive = activeCourierFilter === null;
        const totalBtnClass = isAllActive ? 'bg-green-600 shadow-md transform scale-[1.02]' : 'bg-gray-800 hover:bg-gray-900';
        statsHtml += `<div onclick="showHistoryFromStats()" class="col-span-2 cursor-pointer ${totalBtnClass} text-white p-3 rounded-xl font-bold text-center mt-2 transition-all duration-200 shadow-sm text-sm">Total: ${total} Paket (Tampilkan Semua)</div>`;
      }
      
      document.getElementById('stats-container').innerHTML = statsHtml;
    }

    async function loadDashboard() {
      document.getElementById('stats-loading').classList.remove('hidden');
      
      const startIso = document.getElementById('start-date').value;
      const endIso = document.getElementById('end-date').value;

      try {
        // AMBIL DATA DARI SUPABASE 🚀
        const start = startIso + 'T00:00:00+07:00';
        const end = endIso + 'T23:59:59+07:00';
        
        const { data: scans, error } = await _supabase
          .from('scans')
          .select('*')
          .eq('seller_code', userData.kode)
          .gte('scanned_at', start)
          .lte('scanned_at', end)
          .order('scanned_at', { ascending: false });

        document.getElementById('stats-loading').classList.add('hidden');
        
        if (error) {
           showToast("Gagal mengambil data: " + error.message, "error");
           return;
        }

        // Hitung stats dan history dari hasil Supabase
        const offlineItems = currentDayHistory.filter(i => i.status === 'syncing' || i.status === 'offline');
        
        let newHistory = [];
        let newStats = {};
        
        scans.forEach(s => {
            newStats[s.courier] = (newStats[s.courier] || 0) + 1;
            let d = new Date(s.scanned_at);
            let timeStr = d.toLocaleDateString('id-ID') + ' ' + d.toLocaleTimeString('id-ID');
            newHistory.push({
                id: s.id,
                time: timeStr,
                resi: s.resi,
                courier: s.courier,
                status: 'success'
            });
        });
        
        currentDayHistory = [...offlineItems, ...newHistory];
        localStats = newStats;
        
        // Tambahkan offline item ke stat lokal agar sinkron dengan layar
        offlineItems.forEach(item => {
            if (!localStats[item.courier]) localStats[item.courier] = 0;
            localStats[item.courier]++;
        });

        showAllHistory = false;
        renderStats();
        renderHistoryList(activeCourierFilter); 

      } catch(e) {
        document.getElementById('stats-loading').classList.add('hidden');
        showToast("Jaringan offline.", "error");
      }
    }

    function toggleScan() {
      const btn = document.getElementById('btn-toggle-scan');
      const historyContainer = document.getElementById('history-container');
      
      if (!isScanning) {
        document.getElementById('reader').classList.remove('hidden');
        historyContainer.classList.remove('hidden');
        toggleStats(false);
        
        if (!html5QrcodeScanner) html5QrcodeScanner = new Html5Qrcode("reader");
        
        const config = { 
          fps: 10,
          qrbox: { width: 250, height: 150 },
          formatsToSupport: [ 
            Html5QrcodeSupportedFormats.QR_CODE, 
            Html5QrcodeSupportedFormats.CODE_128, 
            Html5QrcodeSupportedFormats.CODE_39
          ],
          experimentalFeatures: {
            useBarCodeDetectorIfSupported: true 
          }
        };
        
        btn.innerText = "Membuka Kamera...";
        btn.classList.replace('bg-blue-600', 'bg-gray-400');
        
        html5QrcodeScanner.start({ facingMode: "environment" }, config, onScanSuccess)
        .then(() => {
          isScanning = true;
          btn.innerText = "Hentikan Scan Resi";
          btn.classList.replace('bg-gray-400', 'bg-red-600');
        })
        .catch(err => {
          showToast("Kamera gagal diakses. Cek Izin Android.", "error");
          btn.innerText = "Mulai Scan Resi";
          btn.classList.replace('bg-gray-400', 'bg-blue-600');
          document.getElementById('reader').classList.add('hidden');
          historyContainer.classList.add('hidden');
          toggleStats(true);
        });
      } else {
        html5QrcodeScanner.stop().then(() => {
          isScanning = false;
          btn.innerText = "Mulai Scan Resi";
          btn.classList.replace('bg-red-600', 'bg-blue-600');
          document.getElementById('reader').classList.add('hidden');
          historyContainer.classList.add('hidden');
          toggleStats(true);
        });
      }
    }

    function updateOfflineUI() {
      const banner = document.getElementById('offline-banner');
      const count = syncQueue.length;
      if (count > 0 && !isSyncing) {
        banner.classList.remove('hidden');
        document.getElementById('unsynced-count').innerText = count;
      } else {
        banner.classList.add('hidden');
      }
    }

    async function processSyncQueue(isRetry = false) {
      if (syncQueue.length === 0) {
        updateOfflineUI();
        return;
      }
      if (isSyncing && !isRetry) return; 
      
      isSyncing = true;
      if (isRetry) {
        document.getElementById('btn-sync').innerText = "Mengirim...";
      }
      updateOfflineUI();
      
      const item = syncQueue[0];
      
      try {
        // KIRIM DATA KE SUPABASE 🚀
        const { data, error } = await _supabase
          .from('scans')
          .insert([
            { resi: item.resi, courier: item.courier, seller_code: userData.kode }
          ]);
          
        const historyItem = currentDayHistory.find(i => i.id === item.id);
        
        if (error) {
           // Cek apakah error karena Constraint Unik (Resi Duplikat)
           if (error.code === '23505') { 
              if (historyItem) {
                historyItem.status = 'error';
                historyItem.errMsg = "Duplikat Server";
              }
              localStats[item.courier] = Math.max(0, localStats[item.courier] - 1);
              syncQueue.shift(); // Buang dari antrian jika fix duplikat (tidak usah retri)
           } else {
              throw new Error("Gagal menyimpan"); // Lempar ke catch untuk offline retry
           }
        } else {
           if (historyItem) historyItem.status = 'success';
           syncQueue.shift(); // Sukses, buang dari antrian
        }
        
      } catch (err) {
        // JARINGAN TERPUTUS -> MASUK OFFLINE MODE
        const historyItem = currentDayHistory.find(i => i.id === item.id);
        if (historyItem) {
           historyItem.status = 'offline';
           historyItem.errMsg = "Menunggu Sinyal";
        }
        isSyncing = false;
        
        if (isRetry) {
           showToast("Masih tidak ada koneksi internet.", "error");
           document.getElementById('btn-sync').innerText = "Kirim ke Server";
        }
        
        updateOfflineUI();
        renderStats();
        renderHistoryList(activeCourierFilter);
        return; 
      }
      
      isSyncing = false;
      renderStats();
      renderHistoryList(activeCourierFilter);
      
      if (isRetry) {
         document.getElementById('btn-sync').innerText = "Kirim ke Server";
      }
      
      if (syncQueue.length > 0) {
         processSyncQueue();
      } else {
         updateOfflineUI();
         showToast("Semua data berhasil disinkronisasi!", "success");
      }
    }

    function onScanSuccess(decodedText) {
      if (scanCooldown) return;
      
      const resi = decodedText.trim();
      const courier = detectCourier(resi);
      
      scanCooldown = true;

      const isLocalDup = currentDayHistory.some(item => item.resi === resi && item.status !== 'error');
      if (isLocalDup) {
        showToast("DUPLIKAT! Resi " + resi + " sudah discan.", "error");
        playBeep('error');
        setTimeout(() => { scanCooldown = false; }, 2000);
        return;
      }
      
      playBeep('success');

      const tempId = Date.now();
      const timeStr = new Date().toLocaleTimeString('id-ID');
      
      currentDayHistory.unshift({ id: tempId, time: timeStr, resi: resi, courier: courier, status: 'syncing' });
      
      if (!localStats[courier]) localStats[courier] = 0;
      localStats[courier]++;
      
      showAllHistory = false;
      renderStats();
      renderHistoryList(activeCourierFilter);

      syncQueue.push({ id: tempId, resi: resi, courier: courier });
      processSyncQueue();

      setTimeout(() => { scanCooldown = false; }, 1000);
    }
  