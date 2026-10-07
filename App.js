import React, { useEffect, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

let Notifications = null;
if (Constants.appOwnership !== "expo") {
  try {
    Notifications = require("expo-notifications");
  } catch {}
}

const DEFAULT_TASKS = [
  { id: "devotion", name: "Morning devotion", start: "06:00", duration: 60, category: "Personal" },
  { id: "prepare", name: "Get dressed and prepare for class", start: "07:00", duration: 60, category: "Personal" },
  { id: "classes", name: "Classes", start: "08:00", duration: 360, category: "School" },
  { id: "coding", name: "Coding", start: "14:00", duration: 120, category: "Study" },
  { id: "reading", name: "Reading", start: "16:00", duration: 120, category: "Study" },
  { id: "chores", name: "Cooking and other chores", start: "18:00", duration: 120, category: "Home" },
];

if (Notifications) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
    }),
  });
}

const dateKey = (date = new Date()) => date.toISOString().slice(0, 10);

function makeDay(templates, date = dateKey()) {
  return {
    date,
    tasks: templates.filter((task) => task && task.id).map((task) => ({
      ...task,
      id: `${task.id}-${date}`,
      completed: false,
      skipped: false,
    })),
  };
}

export default function App() {
  const [screen, setScreen] = useState("Today");
  const [templates, setTemplates] = useState(DEFAULT_TASKS);
  const [days, setDays] = useState({});
  const [settings, setSettings] = useState({ interval: 15, dark: false });
  const [day, setDay] = useState(null);
  const [editor, setEditor] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadData();
    if (!Notifications) return;

    Notifications.requestPermissionsAsync();
    Notifications.setNotificationCategoryAsync("TASK_REMINDER", [
      { identifier: "SNOOZE", buttonTitle: "Snooze 15 minutes" },
      { identifier: "SKIP", buttonTitle: "Skip today", options: { isDestructive: true } },
    ]);

    const listener = Notifications.addNotificationResponseReceivedListener(
      ({ actionIdentifier, notification }) => {
        const { taskId, date } = notification.request.content.data || {};
        if (actionIdentifier === "SKIP") updateTask(date, taskId, { skipped: true });
        if (actionIdentifier === "SNOOZE") scheduleReminder(taskId, date, 15);
      }
    );

    return () => listener.remove();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const today = days[dateKey()] || makeDay(templates);
    setDay(today);
    if (!days[dateKey()]) saveDay(today);
  }, [loaded, templates]);

  async function loadData() {
    const savedTemplates = await AsyncStorage.getItem("templates");
    const savedDays = await AsyncStorage.getItem("days");
    const savedSettings = await AsyncStorage.getItem("settings");
    const parsedTemplates = savedTemplates ? JSON.parse(savedTemplates) : DEFAULT_TASKS;
    const parsedDays = savedDays ? JSON.parse(savedDays) : {};
    const cleanedDays = Object.fromEntries(
      Object.entries(parsedDays).map(([date, savedDay]) => [
        date,
        {
          ...savedDay,
          tasks: Array.isArray(savedDay?.tasks) ? savedDay.tasks.filter((task) => task && task.id) : [],
        },
      ])
    );

    setTemplates(Array.isArray(parsedTemplates) ? parsedTemplates.filter((task) => task && task.id) : DEFAULT_TASKS);
    setDays(cleanedDays);
    setSettings(savedSettings ? JSON.parse(savedSettings) : { interval: 15, dark: false });
    setLoaded(true);
  }

  async function saveDay(nextDay) {
    const nextDays = { ...days, [nextDay.date]: nextDay };
    setDays(nextDays);
    setDay(nextDay);
    await AsyncStorage.setItem("days", JSON.stringify(nextDays));
  }

  async function saveTemplates(nextTemplates) {
    setTemplates(nextTemplates);
    await AsyncStorage.setItem("templates", JSON.stringify(nextTemplates));
  }

  async function updateSettings(nextSettings) {
    setSettings(nextSettings);
    await AsyncStorage.setItem("settings", JSON.stringify(nextSettings));
  }

  function updateTask(date, taskId, changes) {
    const current = days[date] || makeDay(templates, date);
    const next = {
      ...current,
      tasks: current.tasks.map((task) =>
        task.id === taskId ? { ...task, ...changes } : task
      ),
    };
    saveDay(next);
  }

  function removeTask(date, taskId) {
    const current = days[date];
    saveDay({ ...current, tasks: current.tasks.filter((task) => task.id !== taskId) });
  }

  async function scheduleReminder(taskId, date, minutes = 0) {
    if (!Notifications) return;

    const task = days[date]?.tasks.find((item) => item.id === taskId);
    if (!task) return;

    const [hour, minute] = task.start.split(":").map(Number);
    const when = new Date(`${date}T00:00:00`);
    when.setHours(hour, minute + minutes, 0, 0);

    if (when <= new Date()) return;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: task.name,
        body: minutes ? "This task is still incomplete." : "Task starting now.",
        categoryIdentifier: "TASK_REMINDER",
        data: { taskId, date },
      },
      trigger: { date: when },
    });
  }

  async function scheduleTask(task, date) {
    if (!task) return;

    await scheduleReminder(task.id, date);
    for (let i = 1; i <= 3; i++) {
      await scheduleReminder(task.id, date, settings.interval * i);
    }
  }

  function openDate(value) {
    const selected = days[value] || makeDay(templates, value);
    setDay(selected);
    if (!days[value]) saveDay(selected);
    setScreen("History");
  }

  if (!loaded) return <Text style={styles.loading}>Loading DayPlan...</Text>;

  const dark = settings.dark;
  const colors = dark ? darkColors : lightColors;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {screen === "Today" && (
        <Today
          day={day}
          colors={colors}
          onToggle={(task) => {
            if (!day || !task) return;

            updateTask(day.date, task.id, { completed: !task.completed });
            if (!task.completed && Notifications) Notifications.dismissAllNotificationsAsync();
          }}
          onEdit={(task) => setEditor({ ...task, date: day.date })}
          onAdd={() => setEditor({ date: day.date })}
          onSchedule={scheduleTask}
        />
      )}

      {screen === "History" && (
        <History
          colors={colors}
          currentDay={day}
          onDate={openDate}
          onToggle={(task) =>
            updateTask(day.date, task.id, { completed: !task.completed })
          }
          onEdit={(task) => setEditor({ ...task, date: day.date })}
        />
      )}

      {screen === "Weekly" && <Weekly days={days} colors={colors} />}

      {screen === "Settings" && (
        <Settings
          templates={templates}
          settings={settings}
          colors={colors}
          notificationsUnavailable={!Notifications}
          onSave={saveTemplates}
          onSettings={updateSettings}
        />
      )}

      <View style={[styles.tabs, { borderTopColor: colors.border }]}>
        {["Today", "History", "Weekly", "Settings"].map((item) => (
          <Pressable key={item} onPress={() => setScreen(item)}>
            <Text style={[styles.tab, { color: screen === item ? colors.primary : colors.muted }]}>
              {item}
            </Text>
          </Pressable>
        ))}
      </View>

      <TaskEditor
        value={editor}
        colors={colors}
        onClose={() => setEditor(null)}
        onSave={(task) => {
          const current = days[task.date] || makeDay(templates, task.date);
          const exists = current.tasks.some((item) => item.id === task.id);
          const next = exists
            ? { ...current, tasks: current.tasks.map((item) => item.id === task.id ? task : item) }
            : { ...current, tasks: [...current.tasks, { ...task, completed: false, skipped: false }] };
          saveDay(next);
          setEditor(null);
        }}
        onDelete={(task) => {
          removeTask(task.date, task.id);
          setEditor(null);
        }}
      />
    </SafeAreaView>
  );
}

function Today({ day, colors, onToggle, onEdit, onAdd, onSchedule }) {
  const completed = day?.tasks.filter((task) => task.completed).length || 0;
  const progress = day?.tasks.length ? completed / day.tasks.length : 0;

  if (!day) return null;

  return (
    <View style={styles.content}>
      <Text style={[styles.title, { color: colors.text }]}>DayPlan</Text>
      <Text style={{ color: colors.muted }}>{day?.date}</Text>

      <View style={styles.progressBackground}>
        <View style={[styles.progress, { width: `${progress * 100}%` }]} />
      </View>
      <Text style={{ color: colors.muted }}>{completed}/{day?.tasks.length || 0} completed</Text>

      <FlatList
        data={day?.tasks?.filter(Boolean) || []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TaskRow
            task={item}
            colors={colors}
            onToggle={() => onToggle(item)}
            onEdit={() => onEdit(item)}
            onSchedule={() => onSchedule(item, day.date)}
          />
        )}
      />

      <Pressable style={styles.button} onPress={onAdd}>
        <Text style={styles.buttonText}>+ Add task</Text>
      </Pressable>
    </View>
  );
}

function TaskRow({ task, colors, onToggle, onEdit, onSchedule }) {
  return (
    <Pressable onPress={onEdit} style={[styles.task, { backgroundColor: colors.card }]}>
      <Pressable onPress={onToggle} style={[styles.checkbox, task.completed && styles.checked]}>
        <Text style={styles.checkText}>{task.completed ? "✓" : ""}</Text>
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={[styles.taskName, { color: colors.text }, task.completed && styles.done]}>
          {task.name}
        </Text>
        <Text style={{ color: colors.muted }}>
          {task.start} · {task.duration} min · {task.category}
        </Text>
      </View>
      <Pressable onPress={onSchedule}>
        <Text style={{ color: colors.primary }}>🔔</Text>
      </Pressable>
    </Pressable>
  );
}

function History({ colors, currentDay, onDate, onToggle, onEdit }) {
  const [date, setDate] = useState(currentDay?.date || dateKey());

  return (
    <View style={styles.content}>
      <Text style={[styles.title, { color: colors.text }]}>Day History</Text>
      <TextInput
        value={date}
        onChangeText={setDate}
        placeholder="YYYY-MM-DD"
        style={[styles.input, { color: colors.text, borderColor: colors.border }]}
      />
      <Pressable style={styles.button} onPress={() => onDate(date)}>
        <Text style={styles.buttonText}>Open day</Text>
      </Pressable>
      <FlatList
        data={currentDay?.tasks?.filter(Boolean) || []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TaskRow task={item} colors={colors} onToggle={() => onToggle(item)} onEdit={() => onEdit(item)} />
        )}
      />
    </View>
  );
}

function Weekly({ days, colors }) {
  const entries = Object.values(days).slice(-7).reverse();
  const streak = entries.findIndex((day) => day.tasks.some((task) => !task.completed));

  return (
    <View style={styles.content}>
      <Text style={[styles.title, { color: colors.text }]}>Weekly Summary</Text>
      <Text style={{ color: colors.primary, marginBottom: 20 }}>
        Current streak: {streak < 0 ? entries.length : streak} day(s)
      </Text>
      {entries.map((day) => {
        const done = day.tasks.filter((task) => task.completed).length;
        return (
          <View key={day.date} style={[styles.summary, { backgroundColor: colors.card }]}>
            <Text style={{ color: colors.text }}>{day.date}</Text>
            <Text style={{ color: colors.muted }}>{done} done · {day.tasks.length - done} missed</Text>
          </View>
        );
      })}
    </View>
  );
}

function Settings({ templates, settings, colors, notificationsUnavailable, onSave, onSettings }) {
  return (
    <View style={styles.content}>
      <Text style={[styles.title, { color: colors.text }]}>Settings</Text>
      {notificationsUnavailable && (
        <Text style={[styles.notice, { color: colors.muted }]}>Notifications need a development build</Text>
      )}

      <Text style={[styles.section, { color: colors.text }]}>Default daily tasks</Text>
      {templates.map((task) => (
        <View key={task.id} style={[styles.summary, { backgroundColor: colors.card }]}>
          <TextInput
            value={task.name}
            onChangeText={(name) =>
              onSave(templates.map((item) => item.id === task.id ? { ...item, name } : item))
            }
            style={{ color: colors.text, flex: 1 }}
          />
          <Text style={{ color: colors.muted }}>{task.start} · {task.duration} min</Text>
        </View>
      ))}

      <Text style={[styles.section, { color: colors.text }]}>Reminder interval</Text>
      <TextInput
        value={String(settings.interval)}
        keyboardType="number-pad"
        onChangeText={(interval) => onSettings({ ...settings, interval: Number(interval) || 15 })}
        style={[styles.input, { color: colors.text, borderColor: colors.border }]}
      />

      <View style={styles.row}>
        <Text style={{ color: colors.text }}>Dark mode</Text>
        <Switch
          value={settings.dark}
          onValueChange={(dark) => onSettings({ ...settings, dark })}
        />
      </View>
    </View>
  );
}

function TaskEditor({ value, colors, onClose, onSave, onDelete }) {
  const [task, setTask] = useState(value);

  useEffect(() => setTask(value), [value]);
  if (!value || !task) return null;

  const update = (key, text) => setTask({ ...task, [key]: key === "duration" ? Number(text) : text });

  return (
    <Modal visible transparent animationType="slide">
      <View style={styles.modal}>
        <View style={[styles.modalBox, { backgroundColor: colors.card }]}>
          <Text style={[styles.title, { color: colors.text }]}>
            {task.id ? "Edit task" : "Add task"}
          </Text>

          {[
            ["name", "Task name"],
            ["start", "Start time, e.g. 14:00"],
            ["duration", "Duration in minutes"],
            ["category", "Category"],
          ].map(([key, placeholder]) => (
            <TextInput
              key={key}
              value={String(task[key] || "")}
              placeholder={placeholder}
              placeholderTextColor={colors.muted}
              keyboardType={key === "duration" ? "number-pad" : "default"}
              onChangeText={(text) => update(key, text)}
              style={[styles.input, { color: colors.text, borderColor: colors.border }]}
            />
          ))}

          <Pressable style={styles.button} onPress={() => onSave(task)}>
            <Text style={styles.buttonText}>Save</Text>
          </Pressable>
          {task.id && (
            <Pressable onPress={() => onDelete(task)}>
              <Text style={styles.delete}>Delete task</Text>
            </Pressable>
          )}
          <Pressable onPress={onClose}>
            <Text style={{ textAlign: "center", marginTop: 15 }}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const lightColors = {
  background: "#F6F8FC",
  card: "#FFFFFF",
  text: "#172033",
  muted: "#687386",
  border: "#DDE3EE",
  primary: "#4263EB",
};

const darkColors = {
  background: "#111827",
  card: "#1F2937",
  text: "#F9FAFB",
  muted: "#9CA3AF",
  border: "#374151",
  primary: "#93C5FD",
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, padding: 20 },
  loading: { margin: 30 },
  title: { fontSize: 26, fontWeight: "700", marginBottom: 5 },
  section: { fontSize: 18, fontWeight: "700", marginTop: 20, marginBottom: 10 },
  notice: { marginTop: 8 },
  progressBackground: {
    height: 8,
    backgroundColor: "#DDE3EE",
    borderRadius: 8,
    marginTop: 20,
    marginBottom: 8,
  },
  progress: { height: 8, borderRadius: 8, backgroundColor: "#4263EB" },
  task: {
    flexDirection: "row",
    alignItems: "center",
    padding: 15,
    borderRadius: 14,
    marginTop: 12,
    gap: 12,
  },
  checkbox: {
    width: 25,
    height: 25,
    borderWidth: 2,
    borderColor: "#4263EB",
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  checked: { backgroundColor: "#4263EB" },
  checkText: { color: "white", fontWeight: "700" },
  taskName: { fontSize: 16, fontWeight: "600" },
  done: { textDecorationLine: "line-through", opacity: 0.5 },
  button: {
    backgroundColor: "#4263EB",
    padding: 15,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 15,
  },
  buttonText: { color: "white", fontWeight: "700" },
  tabs: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 15,
    borderTopWidth: 1,
  },
  tab: { fontSize: 12, fontWeight: "700" },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
  },
  summary: {
    padding: 15,
    borderRadius: 12,
    marginBottom: 10,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 20,
  },
  modal: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "#0008",
  },
  modalBox: {
    padding: 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  delete: {
    color: "#DC2626",
    textAlign: "center",
    marginTop: 18,
  },
});