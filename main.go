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
	template := r.FormValue("template")
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

	// --- Формируем уникальный outputPath (теперь просто через timestamp или params, без uid) ---
	base := "C:/Users/Yarik/Downloads/DIPLOMA"
	outputPath := filepath.Join(base, "output", fmt.Sprintf("%s_%d.mp4", template, time.Now().UnixNano()))
	params["output_path"] = outputPath

	// --- Собираем Nexrender job ---
	job, err := buildJob(taskType, template, outputPath, params, username)
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

	saveRenderHistory(username, nexrenderUid, taskType, params, "queued")
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

func saveRenderHistory(username, uid, taskType string, params map[string]interface{}, status string) {
	db, err := sql.Open("sqlite3", "./templates.db")
	if err != nil {
		log.Println("DB error:", err)
		return
	}
	defer db.Close()
	paramsJSON, _ := json.Marshal(params)
	_, err = db.Exec("INSERT INTO render_history (username, uid, type, params, status) VALUES (?, ?, ?, ?, ?)",
		username, uid, taskType, string(paramsJSON), status)
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

	// Если админ — показываем всю историю, иначе только свою
	var rows *sql.Rows
	if role == "admin" {
		rows, err = db.Query("SELECT id, username, uid, type, params, submitted_at, status FROM render_history ORDER BY id DESC LIMIT 100")
	} else {
		rows, err = db.Query("SELECT id, username, uid, type, params, submitted_at, status FROM render_history WHERE username = ? ORDER BY id DESC LIMIT 100", username)
	}
	if err != nil {
		writeJsonError(w, "DB error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var history []map[string]interface{}
	for rows.Next() {
		var id int
		var user, uid, t, params, submittedAt, status string
		if err := rows.Scan(&id, &user, &uid, &t, &params, &submittedAt, &status); err != nil {
			continue
		}
		var paramsObj map[string]interface{}
		json.Unmarshal([]byte(params), &paramsObj)
		history = append(history, map[string]interface{}{
			"id":           id,
			"username":     user,
			"uid":          uid,
			"type":         t,
			"params":       paramsObj,
			"submitted_at": submittedAt,
			"status":       status,
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
			time.Sleep(10 * time.Second)

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
				var myStatus string
				var outputPath string
				var progress float64

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
					if out, ok := statusObj["output"].(string); ok {
						outputPath = out
					}
					if pr, ok := statusObj["progress"].(float64); ok {
						progress = pr
					} else if prInt, ok := statusObj["progress"].(int); ok {
						progress = float64(prInt)
					}
					switch status {
					case "queued":
						myStatus = "queued"
					case "running":
						myStatus = "rendering"
					case "finished":
						myStatus = "done"
						progress = 1.0
					case "errored", "failed", "canceled":
						myStatus = "error"
						progress = 0.0
					default:
						myStatus = "unknown"
					}
				}

				// Сохраняем прогресс в params (JSON)
				dbp, _ := sql.Open("sqlite3", "./templates.db")
				var paramsStr string
				_ = dbp.QueryRow("SELECT params FROM render_history WHERE uid = ?", uid).Scan(&paramsStr)
				var params map[string]interface{}
				_ = json.Unmarshal([]byte(paramsStr), &params)
				params["progress"] = progress
				paramsJSON, _ := json.Marshal(params)
				_, _ = dbp.Exec(`UPDATE render_history SET params = ? WHERE uid = ?`, string(paramsJSON), uid)
				dbp.Close()

				updateRenderHistoryStatus(uid, myStatus, outputPath)
			}
		}
	}()
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

	startStatusUpdater()

	http.Handle("/output/", http.StripPrefix("/output/", http.FileServer(http.Dir("C:/Users/Yarik/Downloads/DIPLOMA/output"))))

	port := ":8080"
	fmt.Println("Сервер запущен на http://192.168.0.128" + port)
	log.Fatal(http.ListenAndServe(port, nil))
}
