#include "mining/catalog.h"

namespace mining {

const MessageOption kMessages[kMessageCount] = {
    {"HELP", "Ayuda"},
    {"OK", "Todo bien"},
    {"COLLAPSE", "Hay derrumbe"},
    {"GAS", "Presencia de gas"},
    {"INJURY", "Compañero herido"},
    {"EVACUATE", "Necesito evacuar"},
    {"SUPPLIES", "Suministros"},
    {"EXIT", "Saliendo de mina"},
};

bool isAutomaticMessage(const std::string& code) { return code == kCoAlarm || code == kHeatAlarm; }

bool isMessageCode(const std::string& code) {
    for (const auto& option : kMessages) {
        if (code == option.code) return true;
    }
    return isAutomaticMessage(code);
}

}  // namespace mining
