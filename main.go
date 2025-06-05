package main

import (
	"bytes"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"log"
	"mime"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

type Template struct {
	ID          int    `json:"id"`
	Name        string `json:"name"`
	Category    string `json:"category"`
	PreviewPath string `json:"preview_path"`
	Description string `json:"description"`
}

type ThesisData struct {
	Theses   []map[string]string `json:"theses"`
	Template string              `json:"template"`
	Image    string              `json:"image,omitempty"`
	Audio    string              `json:"audio,omitempty"`
}

var lastSavedThesis ThesisData

var (
	sessions      = make(map[string]string) // sessionID -> username
	sessionsMutex sync.Mutex
)

// Универсальная функция для возврата ошибок в JSON
func writeJsonError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func checkUser(username, password string) (role string, ok bool) {
	db, err := sql.Open("sqlite3", "./templates.db")
	if err != nil {
		return "", false
	}
	defer db.Close()

	var dbPass, dbRole string
	err = db.QueryRow("SELECT password, role FROM users WHERE username = ?", username).Scan(&dbPass, &dbRole)
	if err != nil {
		return "", false
	}
	err = bcrypt.CompareHashAndPassword([]byte(dbPass), []byte(password))
	if err == nil {
		return dbRole, true
	}
	return "", false
}

func generateSessionID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func loginHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var creds struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&creds); err != nil {
		writeJsonError(w, "Bad request", http.StatusBadRequest)
		return
	}
	role, ok := checkUser(creds.Username, creds.Password)
	if !ok {
		writeJsonError(w, "Неверный логин или пароль", http.StatusUnauthorized)
		return
	}
	sessionID := generateSessionID()
	sessionsMutex.Lock()
	sessions[sessionID] = creds.Username
	sessionsMutex.Unlock()

	http.SetCookie(w, &http.Cookie{
		Name:     "user_session",
		Value:    sessionID,
		Path:     "/",
		HttpOnly: true,
		MaxAge:   86400, // сутки
	})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status": "ok",
		"role":   role,
	})
}

func logoutHandler(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("user_session")
	if err == nil {
		sessionsMutex.Lock()
		delete(sessions, cookie.Value)
		sessionsMutex.Unlock()
	}
	http.SetCookie(w, &http.Cookie{
		Name:    "user_session",
		Value:   "",
		Path:    "/",
		Expires: time.Now().Add(-1 * time.Hour),
		MaxAge:  -1,
	})
	w.WriteHeader(http.StatusOK)
}

func whoamiHandler(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("user_session")
	if err != nil {
		writeJsonError(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	sessionsMutex.Lock()
	username, ok := sessions[cookie.Value]
	sessionsMutex.Unlock()
	if !ok {
		writeJsonError(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	db, err := sql.Open("sqlite3", "./templates.db")
	if err != nil {
		writeJsonError(w, "DB error", http.StatusInternalServerError)
		return
	}
	defer db.Close()
	var role string
	err = db.QueryRow("SELECT role FROM users WHERE username = ?", username).Scan(&role)
	if err != nil {
		writeJsonError(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"username": username,
		"role":     role,
	})
}

// --- СЕРВЕРНАЯ ЗАЩИТА admin.html --- //
func adminPageHandler(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("user_session")
	if err != nil {
		http.Redirect(w, r, "/", http.StatusFound)
		return
	}
	sessionsMutex.Lock()
	username, ok := sessions[cookie.Value]
	sessionsMutex.Unlock()
	if !ok {
		http.Redirect(w, r, "/", http.StatusFound)
		return
	}
	db, err := sql.Open("sqlite3", "./templates.db")
	if err != nil {
		http.Redirect(w, r, "/", http.StatusFound)
		return
	}
	defer db.Close()
	var role string
	err = db.QueryRow("SELECT role FROM users WHERE username = ?", username).Scan(&role)
	if err != nil || role != "admin" {
		http.Redirect(w, r, "/", http.StatusFound)
		return
	}
	http.ServeFile(w, r, "./protected/admin.html") // <--- путь к защищённому admin.html
}

func saveFile(file multipart.File, filename string) error {
	// 1. Пробуем декодировать файл как изображение
	tmpFile, err := os.CreateTemp("", "upload-*.img")
	if err != nil {
		return err
	}
	defer os.Remove(tmpFile.Name())
	defer tmpFile.Close()
	if _, err := io.Copy(tmpFile, file); err != nil {
		return err
	}

	// Пробуем открыть как PNG
	tmpFile.Seek(0, 0)
	img, format, err := image.Decode(tmpFile)
	if err != nil {
		// Fallback: пробуем как JPEG
		tmpFile.Seek(0, 0)
		img, err = jpeg.Decode(tmpFile)
		format = "jpeg"
		if err != nil {
			// Не удалось декодировать вообще, просто сохранить байты как есть
			tmpFile.Seek(0, 0)
			out, err := os.Create(filename)
			if err != nil {
				return err
			}
			defer out.Close()
			_, err = io.Copy(out, tmpFile)
			return err
		}
	}

	// Сохраняем именно как PNG (кодируем всегда как png)
	out, err := os.Create(filename)
	if err != nil {
		return err
	}
	defer out.Close()
	err = png.Encode(out, img)
	if err != nil {
		return err
	}
	log.Printf("Saved %s as PNG (source format: %s)", filename, format)
	return nil
}

func saveTaskHandler(w http.ResponseWriter, r *http.Request) {
	err := r.ParseMultipartForm(50 << 20)
	if err != nil {
		writeJsonError(w, "Ошибка обработки формы", http.StatusBadRequest)
		log.Println("Ошибка формы:", err)
		return
	}

	// --- Получаем username из сессии ---
	cookie, err := r.Cookie("user_session")
	if err != nil {
		writeJsonError(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	sessionsMutex.Lock()
	username, ok := sessions[cookie.Value]
	sessionsMutex.Unlock()
	if !ok {
		writeJsonError(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	taskType := r.FormValue("type")
	templateID := r.FormValue("template") // <- Ожидается ЧИСЛО (id шаблона)

	// --- Если вдруг приходит не id, а имя шаблона ---
	if _, err := strconv.Atoi(templateID); err != nil {
		db, _ := sql.Open("sqlite3", "./templates.db")
		defer db.Close()
		var id int
		_ = db.QueryRow("SELECT id FROM templates WHERE name = ?", templateID).Scan(&id)
		templateID = fmt.Sprintf("%d", id)
	}

	paramsRaw := r.FormValue("params")
	var params map[string]interface{}
	if err := json.Unmarshal([]byte(paramsRaw), &params); err != nil {
		writeJsonError(w, "Ошибка декодирования параметров", http.StatusBadRequest)
		log.Println("Ошибка JSON:", err)
		return
	}

	// --- Файлы (только для тезисов, если нужно) ---
	if taskType == "thesis" {
		audioPath := filepath.Join("C:/Users/Yarik/Downloads/DIPLOMA/input", "audio.mp3")
		if audioFile, _, err := r.FormFile("audio"); err == nil {
			defer audioFile.Close()
			saveFile(audioFile, audioPath)
			params["audioPath"] = audioPath
		}
		if thesesRaw, ok := params["theses"].([]interface{}); ok {
			for i := 1; i <= len(thesesRaw); i++ {
				fieldName := fmt.Sprintf("thesis_img_%d", i)
				file, _, err := r.FormFile(fieldName)
				imgPath := ""
				if err == nil {
					defer file.Close()
					imgPath = filepath.Join("C:/Users/Yarik/Downloads/DIPLOMA/input", fmt.Sprintf("image_%d.png", i))
					saveFile(file, imgPath)
				}
				params[fmt.Sprintf("imagePath_%d", i)] = imgPath
			}
		}
	}

	// --- Формируем уникальный outputPath ---
	base := "C:/Users/Yarik/Downloads/DIPLOMA"
	outputPath := filepath.Join(base, "output", fmt.Sprintf("%s_%d.mp4", templateID, time.Now().UnixNano()))
	params["output_path"] = outputPath

	// --- Собираем Nexrender job ---
	job, err := buildJob(taskType, templateID, outputPath, params, username)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Ошибка сборки job: " + err.Error()})
		return
	}

	log.Printf("ASSETS in job: %+v", job["assets"])
	nexrenderUid, err := createNexrenderJob(job)
	if err != nil {
		writeJsonError(w, "Ошибка отправки задачи в nexrender-server: "+err.Error(), 500)
		log.Println("Ошибка отправки задачи в nexrender-server:", err)
		return
	}

	// --- Сохраняем историю с правильным template_id ---
	saveRenderHistory(username, nexrenderUid, taskType, templateID, params, "queued")
	log.Println("Задача отправлена в nexrender-server, UID:", nexrenderUid)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "render_started", "uid": nexrenderUid})
}

func buildJob(taskType, template, outputPath string, params map[string]interface{}, username string) (map[string]interface{}, error) {
	base := "C:/Users/Yarik/Downloads/DIPLOMA"
	aepPath, err := getAepPathById(template)
	if err != nil || aepPath == "" {
		return nil, fmt.Errorf("Не найден путь к .aep")
	}
	aepFile := filepath.Join(base, "templates", aepPath)

	var assets []map[string]interface{}
	var composition string

	switch taskType {
	case "thesis":
		composition = getCompositionName(template)
		audioPath, _ := params["audioPath"].(string)
		assets = append(assets, map[string]interface{}{
			"composition": "IZ_TEZIS",
			"layerName":   "audio",
			"src":         "file:///" + filepath.ToSlash(audioPath),
			"type":        "audio",
		})

		theses, _ := params["theses"].([]interface{})
		for i, tRaw := range theses {
			t, _ := tRaw.(map[string]interface{})
			compPath := fmt.Sprintf("IZ_TEZIS->Text->Tezis_%d", i+1)
			assets = append(assets,
				map[string]interface{}{
					"composition": compPath,
					"layerName":   "text",
					"type":        "data",
					"property":    "Source Text",
					"value":       t["text"],
				},
				map[string]interface{}{
					"composition": compPath,
					"layerName":   "regalia",
					"type":        "data",
					"property":    "Source Text",
					"value":       t["title"],
				})
			if img, ok := params[fmt.Sprintf("imagePath_%d", i+1)].(string); ok && img != "" {
				assets = append(assets, map[string]interface{}{
					"composition": fmt.Sprintf("IZ_TEZIS->Tezis_Image_%d->IMAGE_%d", i+1, i+1),
					"layerName":   "photo",
					"src":         "file:///" + filepath.ToSlash(img),
					"type":        "image",
				})
			}
		}
	case "quote":
		composition = "QUOTE_MAIN"
		quoteText := params["quote"].(string)
		author := params["author"].(string)
		assets = append(assets,
			map[string]interface{}{
				"composition": composition,
				"layerName":   "text",
				"type":        "data",
				"property":    "Source Text",
				"value":       quoteText,
			},
			map[string]interface{}{
				"composition": composition,
				"layerName":   "author",
				"type":        "data",
				"property":    "Source Text",
				"value":       author,
			})
	default:
		return nil, fmt.Errorf("Неизвестный тип задачи")
	}

	job := map[string]interface{}{
		"template": map[string]string{
			"src":         "file:///" + filepath.ToSlash(aepFile),
			"composition": composition,
			"output":      outputPath,
		},
		"assets":  assets,
		"actions": map[string]interface{}{"postrender": []interface{}{}},
		"data": map[string]interface{}{
			"user": username,
		},
	}
	return job, nil
}

func saveRenderHistory(username, uid, taskType, templateID string, params map[string]interface{}, status string) {
	db, err := sql.Open("sqlite3", "./templates.db")
	if err != nil {
		log.Println("DB error:", err)
		return
	}
	defer db.Close()
	paramsJSON, _ := json.Marshal(params)
	_, err = db.Exec("INSERT INTO render_history (username, uid, type, template_id, params, status) VALUES (?, ?, ?, ?, ?, ?)",
		username, uid, taskType, templateID, string(paramsJSON), status)
	if err != nil {
		log.Println("Ошибка записи истории рендера:", err)
	}
}

func getAepPathById(templateId string) (string, error) {
	db, err := sql.Open("sqlite3", "./templates.db")
	if err != nil {
		return "", err
	}
	defer db.Close()
	var aepPath string
	err = db.QueryRow("SELECT aep_path FROM templates WHERE id = ?", templateId).Scan(&aepPath)
	if err != nil {
		return "", err
	}
	return aepPath, nil
}

func getCompositionName(template string) string {
	mapping := map[string]string{
		"66":      "IZ_TEZIS",
		"quote_1": "QUOTE_MAIN",
	}
	if name, ok := mapping[template]; ok {
		return name
	}
	return "Main"
}

func getNexrenderJobStatus(uid string) (map[string]interface{}, error) {
	resp, err := http.Get("http://localhost:3000/api/v1/jobs/" + uid)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if len(body) == 0 {
		return nil, fmt.Errorf("empty response from nexrender")
	}

	var data map[string]interface{}
	if err := json.Unmarshal(body, &data); err != nil {
		return nil, err
	}
	return data, nil
}

func createNexrenderJob(job interface{}) (string, error) {
	data, err := json.Marshal(job)
	if err != nil {
		return "", err
	}
	resp, err := http.Post("http://localhost:3000/api/v1/jobs", "application/json", bytes.NewBuffer(data))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 201 && resp.StatusCode != 200 {
		return "", fmt.Errorf("Ошибка отправки job: %s", string(body))
	}
	var respData map[string]interface{}
	if err := json.Unmarshal(body, &respData); err != nil {
		return "", err
	}

	fmt.Println("Ответ nexrender:", string(body))
	uid, ok := respData["uid"].(string)
	if !ok || uid == "" {
		// Для надёжности, попытаемся как число
		uidAny := respData["uid"]
		if uidAny != nil {
			uid = fmt.Sprintf("%v", uidAny)
			if uid != "" {
				return uid, nil
			}
		}
		return "", fmt.Errorf("Ошибка: не удалось получить uid из ответа: %s", string(body))
	}
	return uid, nil

}

func getTemplatesHandler(w http.ResponseWriter, r *http.Request) {
	db, err := sql.Open("sqlite3", "./templates.db")
	if err != nil {
		writeJsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer db.Close()

	rows, err := db.Query("SELECT id, name, category, preview_path, description FROM templates")
	if err != nil {
		writeJsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var templates []Template
	for rows.Next() {
		var t Template
		if err := rows.Scan(&t.ID, &t.Name, &t.Category, &t.PreviewPath, &t.Description); err != nil {
			writeJsonError(w, err.Error(), http.StatusInternalServerError)
			return
		}
		templates = append(templates, t)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(templates)
}

func renderStatusHandler(w http.ResponseWriter, r *http.Request) {
	uid := r.URL.Query().Get("uid")
	if uid == "" {
		writeJsonError(w, "uid required", http.StatusBadRequest)
		return
	}
	status, err := getNexrenderJobStatus(uid)
	if err != nil {
		writeJsonError(w, "Ошибка получения статуса", 500)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}

// Получение истории рендеров для текущего пользователя (или всей истории для админа)
// Получение истории рендеров для текущего пользователя (или всей истории для админа)
func renderHistoryHandler(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("user_session")
	if err != nil {
		writeJsonError(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	sessionsMutex.Lock()
	username, ok := sessions[cookie.Value]
	sessionsMutex.Unlock()
	if !ok {
		writeJsonError(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	db, err := sql.Open("sqlite3", "./templates.db")
	if err != nil {
		writeJsonError(w, "DB error", http.StatusInternalServerError)
		return
	}
	defer db.Close()

	// Получаем роль пользователя
	var role string
	err = db.QueryRow("SELECT role FROM users WHERE username = ?", username).Scan(&role)
	if err != nil {
		writeJsonError(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var rows *sql.Rows
	if role == "admin" {
		rows, err = db.Query(`
			SELECT rh.id, t.name, rh.username, rh.uid, rh.type, rh.params, rh.submitted_at, rh.status
			FROM render_history rh
			LEFT JOIN templates t ON rh.template_id = t.id
			ORDER BY rh.id DESC LIMIT 100`)
	} else {
		rows, err = db.Query(`
			SELECT rh.id, t.name, rh.username, rh.uid, rh.type, rh.params, rh.submitted_at, rh.status
			FROM render_history rh
			LEFT JOIN templates t ON rh.template_id = t.id
			WHERE rh.username = ?
			ORDER BY rh.id DESC LIMIT 100`, username)
	}
	if err != nil {
		writeJsonError(w, "DB error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var history []map[string]interface{}
	for rows.Next() {
		var id int
		var templateName, user, uid, t, params, submittedAt, status string
		if err := rows.Scan(&id, &templateName, &user, &uid, &t, &params, &submittedAt, &status); err != nil {
			continue
		}
		var paramsObj map[string]interface{}
		_ = json.Unmarshal([]byte(params), &paramsObj)
		progress := 0.0
		if p, ok := paramsObj["progress"].(float64); ok {
			progress = p
		}
		history = append(history, map[string]interface{}{
			"id":            id,
			"template_name": templateName,
			"username":      user,
			"uid":           uid,
			"type":          t,
			"params":        paramsObj,
			"submitted_at":  submittedAt,
			"status":        status,
			"progress":      progress,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(history)
}

func updateRenderHistoryStatus(uid, newStatus, outputPath string) error {
	db, err := sql.Open("sqlite3", "./templates.db")
	if err != nil {
		return err
	}
	defer db.Close()
	if outputPath != "" {
		// Если нужен output_path — кладём его внутрь params как JSON-поле
		_, err = db.Exec(`
			UPDATE render_history 
			SET status = ?, params = json_set(COALESCE(params, '{}'), '$.output_path', ?) 
			WHERE uid = ?`, newStatus, outputPath, uid)
	} else {
		_, err = db.Exec("UPDATE render_history SET status = ? WHERE uid = ?", newStatus, uid)
	}
	return err
}

func startStatusUpdater() {
	go func() {
		for {
			time.Sleep(2 * time.Second) // Теперь чаще опрашиваем

			db, err := sql.Open("sqlite3", "./templates.db")
			if err != nil {
				log.Println("StatusUpdater: DB error:", err)
				continue
			}

			rows, err := db.Query("SELECT uid, status FROM render_history WHERE status IN ('queued', 'rendering')")
			if err != nil {
				db.Close()
				continue
			}

			var uids []string
			for rows.Next() {
				var uid, status string
				if err := rows.Scan(&uid, &status); err == nil {
					uids = append(uids, uid)
				}
			}
			rows.Close()
			db.Close()

			for _, uid := range uids {
				statusObj, err := getNexrenderJobStatus(uid)
				log.Printf("[DEBUG] Ответ от Nexrender для %s: %+v, err: %v", uid, statusObj, err)
				var myStatus string
				var outputPath string
				var progress float64

				// Получаем старый прогресс из БД
				dbp, _ := sql.Open("sqlite3", "./templates.db")
				var paramsStr string
				_ = dbp.QueryRow("SELECT params FROM render_history WHERE uid = ?", uid).Scan(&paramsStr)
				var params map[string]interface{}
				_ = json.Unmarshal([]byte(paramsStr), &params)
				dbp.Close()

				if err != nil || statusObj == nil {
					// Проверяем, сколько времени прошло с момента создания задачи
					dbCheck, _ := sql.Open("sqlite3", "./templates.db")
					var submittedAt string
					_ = dbCheck.QueryRow("SELECT submitted_at FROM render_history WHERE uid = ?", uid).Scan(&submittedAt)
					dbCheck.Close()

					t, errParse := time.Parse(time.RFC3339, submittedAt)
					if errParse != nil {
						t, errParse = time.Parse("2006-01-02 15:04:05", submittedAt)
						if errParse != nil {
							t, _ = time.Parse("2006-01-02 15:04", submittedAt)
						}
					}
					if !t.IsZero() && time.Since(t) < 90*time.Second {
						log.Printf("StatusUpdater: %s нет в nexrender, задача свежая (%s), ждём...\n", uid, submittedAt)
						continue
					}

					// Проверяем, вдруг output-файл уже готов
					dbFile, _ := sql.Open("sqlite3", "./templates.db")
					var paramsStr string
					_ = dbFile.QueryRow("SELECT params FROM render_history WHERE uid = ?", uid).Scan(&paramsStr)
					dbFile.Close()
					var params map[string]interface{}
					_ = json.Unmarshal([]byte(paramsStr), &params)
					opath, _ := params["output_path"].(string)
					fi, errStat := os.Stat(opath)
					if errStat == nil && fi.Size() > 1024*1024 {
						myStatus = "done"
						outputPath = opath
						log.Printf("StatusUpdater: file найден для %s, ставим done\n", uid)
						progress = 1.0
					} else {
						myStatus = "error"
						outputPath = opath
						log.Printf("StatusUpdater: nexrender error/empty для %s, ставим error\n", uid)
						progress = 0.0
					}
				} else {
					status, _ := statusObj["state"].(string)
					// --- Вот тут меняем: всегда используем renderProgress!
					// 1. Вытаскиваем renderProgress
					// Универсальное вытаскивание renderProgress независимо от типа
					progress = 0
					if prRaw, ok := statusObj["renderProgress"]; ok {
						switch v := prRaw.(type) {
						case float64:
							if v > 1.01 {
								progress = v / 100.0
							} else {
								progress = v
							}
						case int:
							if v > 1 {
								progress = float64(v) / 100.0
							} else {
								progress = float64(v)
							}
						case json.Number:
							prFloat, err := v.Float64()
							if err == nil {
								if prFloat > 1.01 {
									progress = prFloat / 100.0
								} else {
									progress = prFloat
								}
							}
						default:
							// Ну мало ли...
							progress = 0
						}
					}

					// 2. Логика только по progress!
					if progress >= 1.0 {
						myStatus = "done"
						progress = 1.0
					} else if progress > 0.0 {
						myStatus = "rendering"
					} else {
						// Прямо тут учитываем странный unknown от Nexrender
						switch {
						case status == "queued" || status == "created":
							myStatus = "queued"
						case status == "finished":
							myStatus = "done"
						case status == "errored" || status == "failed" || status == "canceled":
							myStatus = "error"
						case status == "picked" || status == "started" || len(status) > 7 && status[:7] == "render:":
							myStatus = "rendering"
						default:
							myStatus = "unknown"
						}

					}

					if out, ok := statusObj["output"].(string); ok && out != "" {
						outputPath = out
					}
				}
				// Обновляем params
				params["progress"] = progress
				paramsJSON, _ := json.Marshal(params)

				// Сохраняем статус и прогресс
				dbp2, _ := sql.Open("sqlite3", "./templates.db")
				_, _ = dbp2.Exec(`UPDATE render_history SET status = ?, params = ? WHERE uid = ?`, myStatus, string(paramsJSON), uid)
				dbp2.Close()

				log.Printf("[PROGRESS] %s | status: %s | progress: %.2f", uid, myStatus, progress)
				updateRenderHistoryStatus(uid, myStatus, outputPath)
			}
		}
	}()
}

// Только для админа!
func adminStatsHandler(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("user_session")
	if err != nil {
		writeJsonError(w, "Unauthorized", 401)
		return
	}
	sessionsMutex.Lock()
	username, ok := sessions[cookie.Value]
	sessionsMutex.Unlock()
	if !ok {
		writeJsonError(w, "Unauthorized", 401)
		return
	}

	db, err := sql.Open("sqlite3", "./templates.db")
	if err != nil {
		writeJsonError(w, "DB error", 500)
		return
	}
	defer db.Close()

	var role string
	err = db.QueryRow("SELECT role FROM users WHERE username = ?", username).Scan(&role)
	if err != nil || role != "admin" {
		writeJsonError(w, "Forbidden", 403)
		return
	}

	var totalTemplates, totalRenders int
	db.QueryRow("SELECT COUNT(*) FROM templates").Scan(&totalTemplates)
	db.QueryRow("SELECT COUNT(*) FROM render_history").Scan(&totalRenders)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]int{
		"total_templates": totalTemplates,
		"total_renders":   totalRenders,
	})
}

func adminRendersHandler(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("user_session")
	if err != nil {
		writeJsonError(w, "Unauthorized", 401)
		return
	}
	sessionsMutex.Lock()
	username, ok := sessions[cookie.Value]
	sessionsMutex.Unlock()
	if !ok {
		writeJsonError(w, "Unauthorized", 401)
		return
	}

	db, err := sql.Open("sqlite3", "./templates.db")
	if err != nil {
		writeJsonError(w, "DB error", 500)
		return
	}
	defer db.Close()

	var role string
	err = db.QueryRow("SELECT role FROM users WHERE username = ?", username).Scan(&role)
	if err != nil || role != "admin" {
		writeJsonError(w, "Forbidden", 403)
		return
	}

	rows, err := db.Query(`
		SELECT rh.id, t.name, rh.username, rh.submitted_at, rh.status, rh.uid, rh.params
		FROM render_history rh
		LEFT JOIN templates t ON rh.template_id = t.id
		ORDER BY rh.id DESC LIMIT 100`)
	if err != nil {
		writeJsonError(w, "DB error", 500)
		return
	}
	defer rows.Close()

	type R struct {
		ID           int     `json:"id"`
		TemplateName string  `json:"template_name"`
		User         string  `json:"user"`
		Date         string  `json:"date"`
		Status       string  `json:"status"`
		UID          string  `json:"uid"`
		Progress     float64 `json:"progress"`
		OutputPath   string  `json:"output_path"`
	}

	var history []R
	for rows.Next() {
		var r R
		var paramsStr string
		rows.Scan(&r.ID, &r.TemplateName, &r.User, &r.Date, &r.Status, &r.UID, &paramsStr)
		// Достаем прогресс и output_path из params
		var params map[string]interface{}
		_ = json.Unmarshal([]byte(paramsStr), &params)
		if v, ok := params["progress"].(float64); ok {
			r.Progress = v
		} else {
			r.Progress = 0
		}
		if op, ok := params["output_path"].(string); ok {
			r.OutputPath = op
		}
		history = append(history, r)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(history)
}

func main() {
	_ = mime.AddExtensionType(".js", "application/javascript")

	fs := http.FileServer(http.Dir("./static"))
	http.Handle("/", fs)

	http.HandleFunc("/save-task", saveTaskHandler)
	http.HandleFunc("/api/templates", getTemplatesHandler)

	http.HandleFunc("/api/login", loginHandler)
	http.HandleFunc("/api/logout", logoutHandler)
	http.HandleFunc("/api/whoami", whoamiHandler)

	// --- Защита админки через сервер ---
	http.HandleFunc("/protected/admin.html", adminPageHandler)

	http.HandleFunc("/api/render-status", renderStatusHandler)

	http.HandleFunc("/api/render-history", renderHistoryHandler)

	http.HandleFunc("/api/admin/stats", adminStatsHandler)
	http.HandleFunc("/api/admin/renders", adminRendersHandler)

	startStatusUpdater()

	http.Handle("/output/", http.StripPrefix("/output/", http.FileServer(http.Dir("C:/Users/Yarik/Downloads/DIPLOMA/output"))))

	port := ":8080"
	fmt.Println("Сервер запущен на http://192.168.0.128" + port)
	log.Fatal(http.ListenAndServe(port, nil))
}
